"""TIGER/Line 2020 tracts and places: fixed graph nodes, rook adjacency and Chapel Hill overlap.

Area overlap is reported only as a diagnostic; town totals come from block-to-place sums (see lodes.py).
Distances use a local equirectangular projection around 36 N, which is adequate for adjacency lengths.
"""
from __future__ import annotations
import math
import pandas as pd
import shapefile
from shapely.geometry import shape
from shapely.ops import transform
from shapely.strtree import STRtree
from ..config import PROCESSED, REGION_COUNTIES, CHAPEL_HILL_PLACE
from .raw import fetch

SID = "S02"
TIGER = "https://www2.census.gov/geo/tiger/TIGER2020"
KX, KY = 111_320 * math.cos(math.radians(36.0)), 110_540  # metres per degree near Chapel Hill
project = lambda g: transform(lambda x, y, z=None: (x * KX, y * KY), g)


def _read(zip_path):
    r = shapefile.Reader(str(zip_path))
    fields = [f[0] for f in r.fields[1:]]
    for sr in r.iterShapeRecords():
        yield dict(zip(fields, sr.record)), shape(sr.shape.__geo_interface__)


def build() -> dict[str, pd.DataFrame]:
    tract_zip = fetch(SID, f"{TIGER}/TRACT/tl_2020_37_tract.zip")
    place_zip = fetch(SID, f"{TIGER}/PLACE/tl_2020_37_place.zip")
    town = next(project(g) for rec, g in _read(place_zip) if rec["GEOID"] == CHAPEL_HILL_PLACE)
    rows, geoms = [], []
    for rec, g in _read(tract_zip):
        if rec["STATEFP"] + rec["COUNTYFP"] not in REGION_COUNTIES:
            continue
        pg = project(g)
        rows.append({"geoid": rec["GEOID"], "county": rec["STATEFP"] + rec["COUNTYFP"], "name": rec["NAMELSAD"],
                     "lat": float(rec["INTPTLAT"]), "lon": float(rec["INTPTLON"]), "aland_m2": rec["ALAND"],
                     "town_area_share": round(pg.intersection(town).area / pg.area, 6) if pg.area else 0.0})
        geoms.append(pg)
    tracts = pd.DataFrame(rows)
    tree, adj = STRtree(geoms), []
    for i, g in enumerate(geoms):
        for j in tree.query(g):
            if j <= i:
                continue
            shared = g.boundary.intersection(geoms[j].boundary).length
            if shared > 1.0:  # rook adjacency: a shared edge, not a corner touch
                adj.append({"a": tracts.geoid[i], "b": tracts.geoid[j], "shared_m": round(shared, 1)})
    adjacency = pd.DataFrame(adj)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    tracts.to_csv(PROCESSED / "tracts_2020.csv", index=False)
    adjacency.to_csv(PROCESSED / "tract_adjacency.csv", index=False)
    print(f"{len(tracts)} region tracts, {len(adjacency)} adjacent pairs, "
          f"{(tracts.town_area_share > 0.01).sum()} tracts overlap the 2020 Chapel Hill place")
    return {"tracts": tracts, "adjacency": adjacency}


if __name__ == "__main__":
    build()
