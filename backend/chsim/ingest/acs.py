"""ACS 5-year detailed tables (dossier section 4). Runs only with CENSUS_API_KEY; otherwise records the gap.

Keeps E estimates, M margins and annotations. Burden >=30% = (B25070_007..010)/(B25070_001 - B25070_011).
ACS 5-year values are dated, overlapping, noisy context, never annual labels (SE = MOE / 1.645).
"""
from __future__ import annotations
import json, os
import httpx
import pandas as pd
from ..config import PROCESSED, REGION_COUNTIES, STATE_FIPS, CHAPEL_HILL_PLACE
from .raw import RAW, _log, _now

VARS = ["B01003_001", "B25001_001", "B25002_002", "B25002_003", "B25003_003", "B19013_001", "B25064_001", "B25077_001",
        "B25070_001", "B25070_007", "B25070_008", "B25070_009", "B25070_010", "B25070_011", "B23025_004"]
YEARS = list(range(2009, 2025))


def _query(year: int, geo: dict, key: str) -> list[list[str]]:
    fields = ",".join(["NAME"] + [f"{v}{s}" for v in VARS for s in ("E", "M")])
    r = httpx.get(f"https://api.census.gov/data/{year}/acs/acs5", params={"get": fields, **geo, "key": key}, timeout=60)
    r.raise_for_status()
    return r.json()


def build() -> dict:
    key = os.environ.get("CENSUS_API_KEY")
    status_path = PROCESSED / "acs_status.json"
    if not key:
        status = {"status": "missing: credential", "detail": "Set CENSUS_API_KEY to ingest ACS tables; rent and burden "
                  "outputs stay 'unavailable' until then.", "checked_at": _now()}
        status_path.write_text(json.dumps(status, indent=2))
        return status
    rows, failed = [], []  # failed: (end year, geography) requests that did not come back
    (RAW / "S21").mkdir(parents=True, exist_ok=True)
    for y in YEARS:
        geos = {"place": {"for": f"place:{CHAPEL_HILL_PLACE[2:]}", "in": f"state:{STATE_FIPS}"}}
        for cty in REGION_COUNTIES:
            geos[f"tract_{cty}"] = {"for": "tract:*", "in": f"state:{STATE_FIPS} county:{cty[2:]}"}
        for name, geo in geos.items():
            try:
                data = _query(y, geo, key)
            except httpx.HTTPError as e:
                _log("S21", {"url": f"acs5/{y}/{name}", "status": "error", "error": str(e), "retrieved_at": _now()})
                failed.append((y, name))
                continue
            (RAW / "S21" / f"acs5_{y}_{name}.json").write_text(json.dumps(data))
            head, *body = data
            for rec in body:
                d = dict(zip(head, rec))
                geoid = d.get("state", "") + d.get("county", "") + d.get("tract", "") if "tract" in d else d["state"] + d["place"]
                for v in VARS:
                    e, m = pd.to_numeric(d.get(f"{v}E"), errors="coerce"), pd.to_numeric(d.get(f"{v}M"), errors="coerce")
                    # Census uses large negative sentinels for suppressed/not-applicable: keep them missing, never zero.
                    rows.append({"geoid": geoid, "end_year": y, "window": f"{y-4}-{y}", "var": v,
                                 "estimate": e if e is not None and e > -1e8 else None,
                                 "moe": m if m is not None and m > -1e8 else None})
    return _write(rows, failed, status_path)


COLUMNS = ["geoid", "end_year", "window", "var", "estimate", "moe"]


def _piece(old: pd.DataFrame, year: int, name: str) -> pd.Series:
    """Rows of a previous file that one (end year, geography) request would have produced."""
    geo = old.geoid.astype(str)
    where = geo.str.startswith(name.removeprefix("tract_")) & (geo.str.len() == 11) if name.startswith("tract_") else geo == CHAPEL_HILL_PLACE
    return (old.end_year == year) & where


def _write(rows: list[dict], failed: list[tuple[int, str]], status_path) -> dict:
    """Writes the observations, never losing what an earlier refresh collected: a request that failed this time keeps
    its rows from the previous file (reported as kept), and a refresh where nothing came back leaves the file alone.
    The status names every missing piece, so an incomplete refresh is never reported as complete."""
    out = PROCESSED / "acs5_observations.csv"
    old = pd.read_csv(out, dtype={"geoid": str}) if out.exists() else pd.DataFrame(columns=COLUMNS)
    missing = [{"end_year": y, "geography": name, "kept_previous": bool(_piece(old, y, name).any())} for y, name in failed]
    if not rows:
        status = {"status": "error: no ACS responses" + ("; previous observations kept" if len(old) else ""),
                  "rows": len(old), "missing": missing, "checked_at": _now()}
        status_path.write_text(json.dumps(status, indent=2))
        return status
    df = pd.DataFrame(rows, columns=COLUMNS)
    if failed and len(old):
        keep = pd.Series(False, index=old.index)
        for y, name in failed:
            keep |= _piece(old, y, name)
        df = pd.concat([df, old[keep][COLUMNS]], ignore_index=True)
    tmp = out.with_suffix(".csv.tmp")  # written whole, then swapped in, so a crash mid-write never leaves half a file
    df.to_csv(tmp, index=False)
    tmp.replace(out)
    status = {"status": "partial" if failed else "ingested", "rows": len(df), "years": YEARS, "missing": missing, "checked_at": _now()}
    status_path.write_text(json.dumps(status, indent=2))
    return status


if __name__ == "__main__":
    print(build())
