"""LODES8 North Carolina: primary jobs (JT01) at workplace (WAC, C000), residence (RAC, C000) and OD flows (S000).

Blocks are 2020 blocks throughout LODES8, so they aggregate to fixed 2020 tracts with the release crosswalk.
Town totals sum blocks whose 2020 place code is Chapel Hill (3711800): exact for the 2020 Census place,
which is not necessarily the current corporate limit.
"""
from __future__ import annotations
import gzip, hashlib
from pathlib import Path
import pandas as pd
from ..config import PANEL_YEARS, PROCESSED, REGION_COUNTIES, CHAPEL_HILL_PLACE
from .raw import fetch

BASE = "https://lehd.ces.census.gov/data/lodes/LODES8/nc"
SID = "S24"
# CNS01-CNS20 (NAICS supersectors) folded into five groups (sector composition context).
SECTORS = {
    "goods": ["CNS01", "CNS02", "CNS03", "CNS04", "CNS05"],
    "trade": ["CNS06", "CNS07", "CNS08"],
    "services": ["CNS09", "CNS10", "CNS11", "CNS12", "CNS13", "CNS14", "CNS17", "CNS18", "CNS19"],
    "edu_health": ["CNS15", "CNS16"],
    "public": ["CNS20"],
}
EXT_NC, EXT_OOS = "EXT_NC", "EXT_OUT_OF_STATE"


def _checksums() -> dict[str, str]:
    path = fetch(SID, f"{BASE}/lodes_nc.sha256sum")
    return {name.strip(): h for h, name in (l.split(None, 1) for l in path.read_text().splitlines() if l.strip())}


def _verify(path: Path, sums: dict[str, str]) -> bool:
    """Published sums are of the uncompressed CSV."""
    expected = sums.get(path.name.removesuffix(".gz"))
    if expected is None:
        return False
    h = hashlib.sha256()
    with gzip.open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    if h.hexdigest() != expected:
        raise ValueError(f"checksum mismatch for {path.name}")
    return True


def download(years=PANEL_YEARS) -> dict:
    sums = _checksums()
    files = {"xwalk": fetch(SID, f"{BASE}/nc_xwalk.csv.gz")}
    verified = {"nc_xwalk.csv.gz": _verify(files["xwalk"], sums)}
    for y in years:
        for kind, sub in [("wac", f"wac/nc_wac_S000_JT01_{y}.csv.gz"), ("rac", f"rac/nc_rac_S000_JT01_{y}.csv.gz"),
                          ("od_main", f"od/nc_od_main_JT01_{y}.csv.gz"), ("od_aux", f"od/nc_od_aux_JT01_{y}.csv.gz")]:
            p = fetch(SID, f"{BASE}/{sub}")
            files[f"{kind}_{y}"] = p
            verified[p.name] = _verify(p, sums)
    return {"files": files, "verified": verified}


def crosswalk(path: Path) -> pd.DataFrame:
    xw = pd.read_csv(path, usecols=["tabblk2020", "cty", "trct", "stplc"], dtype=str)
    xw["in_region"] = xw["cty"].isin(REGION_COUNTIES)
    xw["in_town"] = xw["stplc"] == CHAPEL_HILL_PLACE
    return xw.set_index("tabblk2020")


def build(files: dict, years=PANEL_YEARS) -> dict[str, pd.DataFrame]:
    xw = crosswalk(files["xwalk"])
    tract_of, region, town = xw["trct"], xw["in_region"], xw["in_town"]
    tract_rows, od_rows, town_rows = [], [], []
    for y in years:
        wac = pd.read_csv(files[f"wac_{y}"], dtype={"w_geocode": str})
        wac = wac[wac["w_geocode"].map(region).fillna(False)]
        wac["tract"] = wac["w_geocode"].map(tract_of)
        wac["town"] = wac["w_geocode"].map(town).fillna(False)
        agg = {"wac_c000": ("C000", "sum")} | {f"wac_{k}": (k, "sum") for k in SECTORS}
        for k, cols in SECTORS.items():
            wac[k] = wac[cols].sum(axis=1)
        wt = wac.groupby("tract").agg(**agg)
        wt["wac_town_c000"] = wac[wac["town"]].groupby("tract")["C000"].sum()

        rac = pd.read_csv(files[f"rac_{y}"], usecols=["h_geocode", "C000"], dtype={"h_geocode": str})
        rac = rac[rac["h_geocode"].map(region).fillna(False)]
        rac["tract"] = rac["h_geocode"].map(tract_of)
        rac["town"] = rac["h_geocode"].map(town).fillna(False)
        rt = rac.groupby("tract").agg(rac_c000=("C000", "sum"))
        rt["rac_town_c000"] = rac[rac["town"]].groupby("tract")["C000"].sum()

        t = wt.join(rt, how="outer").fillna(0).astype(int).reset_index().rename(columns={"index": "tract"})
        t.insert(1, "year", y)
        tract_rows.append(t)

        # OD: keep region-to-region tract flows; collapse the rest into explicit external bins, never dropping mass.
        flows, town_in, town_out_nc, town_internal = [], 0, 0, 0
        for chunk in pd.read_csv(files[f"od_main_{y}"], usecols=["w_geocode", "h_geocode", "S000"],
                                 dtype={"w_geocode": str, "h_geocode": str}, chunksize=2_000_000):
            wr, hr = chunk["w_geocode"].map(region).fillna(False), chunk["h_geocode"].map(region).fillna(False)
            c = chunk[wr | hr].copy()
            c["w"] = c["w_geocode"].map(tract_of).where(c["w_geocode"].map(region).fillna(False), EXT_NC)
            c["h"] = c["h_geocode"].map(tract_of).where(c["h_geocode"].map(region).fillna(False), EXT_NC)
            flows.append(c.groupby(["h", "w"])["S000"].sum())
            wt_, ht_ = chunk["w_geocode"].map(town).fillna(False), chunk["h_geocode"].map(town).fillna(False)
            town_internal += int(chunk.loc[wt_ & ht_, "S000"].sum())
            town_out_nc += int(chunk.loc[ht_ & ~wt_, "S000"].sum())
            town_in += int(chunk.loc[wt_ & ~ht_, "S000"].sum())
        aux = pd.read_csv(files[f"od_aux_{y}"], usecols=["w_geocode", "h_geocode", "S000"], dtype={"w_geocode": str, "h_geocode": str})
        aux = aux[aux["w_geocode"].map(region).fillna(False)]
        aux_town_in = int(aux.loc[aux["w_geocode"].map(town).fillna(False), "S000"].sum())
        aux = aux.assign(h=EXT_OOS, w=aux["w_geocode"].map(tract_of)).groupby(["h", "w"])["S000"].sum()
        od = pd.concat(flows + [aux]).groupby(level=[0, 1]).sum().reset_index()
        od.insert(0, "year", y)
        od_rows.append(od)

        town_rows.append({
            "year": y,
            "workplace_jobs": int(wac.loc[wac["town"], "C000"].sum()),
            "resident_primary_jobs": int(rac.loc[rac["town"], "C000"].sum()),
            "residents_working_in_town": town_internal,
            "residents_working_elsewhere_in_nc": town_out_nc,
            "in_commuters_from_nc": town_in,
            "in_commuters_from_out_of_state": aux_town_in,
        })
        print(f"LODES {y}: {len(t)} tracts, {len(od)} OD pairs, town jobs {town_rows[-1]['workplace_jobs']}")

    town = pd.DataFrame(town_rows)
    # NC residents working out of state are absent from NC files (needs other states' aux files): share is NC-only.
    town["external_workplace_share_nc"] = town["residents_working_elsewhere_in_nc"] / (
        town["residents_working_in_town"] + town["residents_working_elsewhere_in_nc"])
    out = {"tract_year": pd.concat(tract_rows, ignore_index=True), "od": pd.concat(od_rows, ignore_index=True), "town_year": town}
    PROCESSED.mkdir(parents=True, exist_ok=True)
    for name, df in out.items():
        df.to_csv(PROCESSED / f"lodes_{name}.csv", index=False)
    return out


if __name__ == "__main__":
    result = download()
    bad = [k for k, v in result["verified"].items() if not v]
    print("checksums verified:", sum(result["verified"].values()), "unverified:", bad)
    build(result["files"])
