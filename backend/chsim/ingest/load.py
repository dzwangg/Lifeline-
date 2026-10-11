"""Load processed evidence into the canonical store and write docs/data-coverage.md.

Run after lodes.py, tiger.py, local.py and acs.py:  python -m chsim.ingest.load
"""
from __future__ import annotations
import json
import pandas as pd
from sqlalchemy import delete
from ..config import PROCESSED, REPO, CHAPEL_HILL_PLACE, DATA_VERSION, PANEL_YEARS
from ..store.db import engine, init_db
from ..store import models as M
from .raw import manifest
from .sources import SOURCES


def replace_all(pairs, bind=None) -> None:
    """Swaps the contents of several tables in one transaction on one connection: a failed insert rolls the deletions
    back, so a broken refresh keeps the old evidence. Children are cleared before the rows they reference and parents
    are written first, so foreign keys (Membership -> Area) hold on databases that enforce them, such as PostgreSQL."""
    order = {t.name: i for i, t in enumerate(M.Base.metadata.sorted_tables)}  # parents before children
    pairs = sorted(pairs, key=lambda p: order[p[0].name])
    with (bind or engine).begin() as c:
        for table, _ in reversed(pairs):
            c.execute(delete(table))
        for table, df in pairs:
            df.to_sql(table.name, c, if_exists="append", index=False, chunksize=5000)


def load() -> dict:
    init_db()
    pending = []  # (table, rows): every table is built first, then all are swapped together (replace_all)
    _replace = lambda table, df: pending.append((table, df))
    tracts = pd.read_csv(PROCESSED / "tracts_2020.csv", dtype={"geoid": str, "county": str})
    ty = pd.read_csv(PROCESSED / "lodes_tract_year.csv", dtype={"tract": str})
    town = pd.read_csv(PROCESSED / "lodes_town_year.csv")
    adj = pd.read_csv(PROCESSED / "tract_adjacency.csv", dtype={"a": str, "b": str})
    od = pd.read_csv(PROCESSED / "lodes_od.csv", dtype={"h": str, "w": str})
    ev = json.loads((PROCESSED / "local_evidence.json").read_text())

    areas = tracts.assign(kind="tract", vintage="2020")[["geoid", "vintage", "kind", "county", "name", "lat", "lon"]]
    extra = pd.DataFrame([
        {"geoid": CHAPEL_HILL_PLACE, "vintage": "2020", "kind": "place", "county": None, "name": "Chapel Hill town"},
        {"geoid": "EXT_NC", "vintage": "2020", "kind": "external", "county": None, "name": "Rest of North Carolina"},
        {"geoid": "EXT_OUT_OF_STATE", "vintage": "2020", "kind": "external", "county": None, "name": "Out of state (NC aux file)"}])
    _replace(M.Area.__table__, pd.concat([areas, extra], ignore_index=True))

    # Membership: share of each tract's workplace jobs located in 2020 Chapel Hill place blocks (exact block allocation).
    mem = ty[ty.wac_c000 > 0].assign(jurisdiction=CHAPEL_HILL_PLACE, weight=lambda d: d.wac_town_c000 / d.wac_c000,
                                     rule="lodes-block-workplace-jobs")
    mem = mem[mem.weight > 0][["tract", "jurisdiction", "year", "weight", "rule"]].rename(columns={"tract": "area_geoid"})
    area_w = tracts[tracts.town_area_share > 0][["geoid", "town_area_share"]].rename(
        columns={"geoid": "area_geoid", "town_area_share": "weight"})
    area_w = area_w.assign(jurisdiction=CHAPEL_HILL_PLACE, year=2020, rule="area-overlap (approximation, diagnostic only)")
    _replace(M.Membership.__table__, pd.concat([mem, area_w], ignore_index=True))

    obs = []
    for col, concept in [("wac_c000", "workplace_primary_jobs"), ("rac_c000", "resident_primary_jobs")]:
        obs.append(ty.assign(area_geoid=ty.tract, concept=concept, value=ty[col]))
    for col in ["workplace_jobs", "resident_primary_jobs", "residents_working_in_town", "residents_working_elsewhere_in_nc"]:
        obs.append(town.assign(area_geoid=CHAPEL_HILL_PLACE, concept=f"town_{col}", value=town[col]))
    obs = pd.concat(obs, ignore_index=True)
    obs = obs.assign(ref_start=obs.year.astype(str) + "-01-01", ref_end=obs.year.astype(str) + "-12-31", moe=None,
                     unit="jobs", status="observed", source_id="S24", release="LODES8")
    _replace(M.AreaObservation.__table__, obs[["area_geoid", "concept", "ref_start", "ref_end", "value", "moe", "unit",
                                               "status", "source_id", "release"]])

    rel = pd.concat([
        adj.rename(columns={"a": "src", "b": "dst", "shared_m": "weight"}).assign(relation="adjacency", year=None, source_id="S02"),
        od.rename(columns={"h": "src", "w": "dst", "S000": "weight"}).assign(relation="commute", source_id="S24")],
        ignore_index=True)
    _replace(M.GraphRelation.__table__, rel[["src", "dst", "relation", "year", "weight", "source_id"]])

    g = pd.read_csv(PROCESSED / "housing_grants_S13.csv", dtype={"PIN": str})
    approved = g.assign(event="approved", fiscal_year=g.fy_approved, units_new=g.DevelopmentUnitsApproved,
                        units_preserved=g.PreservationUnitsApproved, dollars=g.Total)
    done = g[g.fy_completed.notna()]
    completed = done.assign(event="completed", fiscal_year=done.fy_completed, units_new=done.DevelopmentUnitsCompleted,
                            units_preserved=done.PreservationUnitsCompleted, dollars=None)
    pe = pd.concat([approved, completed], ignore_index=True)
    pe = pe.assign(project_id=pe.Project_or_Development.fillna("") + "#" + pe.OBJECTID.astype(str), pin=pe.PIN, source_id="S13")
    _replace(M.ProjectEvent.__table__, pe[["project_id", "pin", "event", "fiscal_year", "units_new", "units_preserved",
                                           "dollars", "source_id"]])

    tb = ev["taxable_base"]
    fiscal = pd.DataFrame([
        {"town": CHAPEL_HILL_PLACE, "fund": "General", "fiscal_year": 2026, "concept": "town_property_tax_rate_cents_per_100",
         "kind": "adopted", "value": 50.0, "basis": "rate", "source_id": "repo:data/assumptions.json",
         "note": "Town of Chapel Hill FY2025-26 rate, 50.0 cents per $100 (as cited in data/assumptions.json)."},
        {"town": CHAPEL_HILL_PLACE, "fund": "General", "fiscal_year": 2026, "concept": "town_taxable_real_property_value",
         "kind": "estimate", "value": tb["town_taxable_assessed_value"], "basis": "parcel snapshot", "source_id": "S05+S06",
         "note": " ".join(tb["quality"])}])
    _replace(M.MunicipalFiscal.__table__, fiscal)

    assets = []
    for sid, s in SOURCES.items():
        entries = manifest(sid)
        ok = [e for e in entries if e.get("status") == 200]
        assets.append({"source_id": sid, "title": s["title"], "url": s["url"], "file": ok[-1]["file"] if ok else None,
                       "sha256": ok[-1].get("sha256") if ok else None, "retrieved_at": ok[-1]["retrieved_at"] if ok else None,
                       "access_result": f"{len(ok)} file(s) retrieved" if ok else ("not attempted" if not entries else "error"),
                       "coverage": None})
    _replace(M.SourceAsset.__table__, pd.DataFrame(assets))
    replace_all(pending)
    return write_coverage(town, ev)


def write_coverage(town: pd.DataFrame, ev: dict) -> dict:
    acs = json.loads((PROCESSED / "acs_status.json").read_text())
    tb, ri, hg = ev["taxable_base"], ev["restricted_inventory"], ev["housing_grants"]
    lags = hg["development_completion_lag_years"]
    first, last = town.iloc[0], town.iloc[-1]
    lines = [
        "# Data coverage report", "",
        f"Generated by `python -m chsim.ingest.load` (data version `{DATA_VERSION}`). Every number below was computed from "
        "files retrieved by this repository's adapters; see `backend/data/raw/*/manifest.jsonl` for URLs, hashes and times.", "",
        "## Observed and used for the baseline", "",
        f"- **LODES8 primary jobs (S24)**: WAC/RAC/OD JT01 for {PANEL_YEARS[0]}-{PANEL_YEARS[-1]}, all files checksum-verified. "
        "396 tracts in Orange, Durham, Wake, Chatham and Alamance counties (2020 geography).",
        f"- Chapel Hill (2020 Census place blocks) workplace primary jobs: {int(first.workplace_jobs):,} in {int(first.year)}, "
        f"{int(last.workplace_jobs):,} in {int(last.year)}. Resident primary jobs {int(last.resident_primary_jobs):,} in "
        f"{int(last.year)}; NC-only external workplace share {last.external_workplace_share_nc:.1%}.",
        "- Identity check: town workplace jobs = residents working in town + NC in-commuters + out-of-state in-commuters, every year.",
        "- The 2020 Census place is not necessarily the current corporate limit (S01, retrieved separately).",
        "- **TIGER 2020 (S02)**: tract geometry and rook adjacency; 21 tracts overlap the 2020 place.", "",
        "## Observed evidence used as context or calibration (not baseline series)", "",
        f"- **Taxable real property (S05+S06)**: ${tb['town_taxable_assessed_value'] / 1e9:.2f}B, an unaudited current parcel snapshot.",
        *[f"  - {q}" for q in tb["quality"]],
        f"- **Restricted affordable units (S16)**: {ri['restricted_units_chapel_hill']:,} units in Chapel Hill (FY2025 inventory); "
        f"{ri['expiry_unknown_units']:,} have no affordability end date (unknown, not permanent).",
        *[f"  - {q}" for q in ri["quality"]],
        f"- **Housing grants inventory (S13)**: {hg['rows']} rows, ${hg['approved_dollars_total'] / 1e6:.1f}M approved FY2007-FY2024; "
        f"{len(lags)} development rows with approval and completion years (lag {min(lags)}-{max(lags)} fiscal years). "
        "Used as an observational delay distribution for the housing card, not as a causal effect.",
        *[f"  - {q}" for q in hg["quality"]],
        "- **Downtown tenants (S36)**: stale 2020 downtown sample; reported, not used.", "",
        "## Missing, blocked or unusable", "",
        f"- **ACS 5-year (S21)**: {acs['status']}. Rent and burden trajectories are unavailable; the rent level shown in the UI is the "
        "QuickFacts ACS 2019-2023 median gross rent already cited in `data/baselines.json`, with no MOE captured.",
        *[f"- **{k}**: " + " ".join(v["quality"]) for k, v in ev.items() if isinstance(v, dict) and v.get("usable") is False],
        "- **Business establishment registry, grant applicants/awards/outcomes, hiring-subsidy contracts**: not publicly available; "
        "the business and hiring cards run on disclosed assumption ranges.",
        "- **County assessment history, sales-tax distributions (S45), audited fund balances (S42)**: not acquired; the fiscal ledger "
        "uses labeled illustrative placeholders for these lines.",
        "- **Construction constraints (S55-S62: terrain, soils, flood, wetlands, sewer capacity)**: not acquired; the housing card "
        "uses an assumed annual capacity cap, labeled as such.",
    ]
    (REPO / "docs" / "data-coverage.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"town_years": len(town), "acs": acs["status"]}


if __name__ == "__main__":
    print(load())
