"""Bake OpenStreetMap data for downtown Chapel Hill + UNC into chapel-hill.js for index.html.

Usage: python meridian-city/fetch_osm.py [raw_overpass.json]   (stdlib only; no arg = fetch from Overpass)
Output is in local metres around the bbox centre: x = east, z = south. Data (c) OpenStreetMap contributors, ODbL.
"""
import json
import math
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

S, W, N, E = 35.8959, -79.0675, 35.9211, -79.0365
LAT0, LNG0 = (S + N) / 2, (W + E) / 2
KX, KZ = 111320 * math.cos(math.radians(LAT0)), 110574  # metres per degree
EXT = round((E - W) * KX / 2)  # half-size of the area; roads are clipped a little beyond it

QUERY = f"""[out:json][timeout:120][bbox:{S},{W},{N},{E}];
(
  way[building]; relation[building][type=multipolygon];
  way[highway];
  way[leisure~"^(park|pitch|garden|golf_course)$"]; way[landuse~"^(grass|forest|meadow|recreation_ground|cemetery|village_green)$"]; way[natural~"^(wood|water|scrub)$"];
  way[amenity=parking];
  node[natural=tree];
);
out geom;"""
SHOP_AMENITY = {"restaurant", "cafe", "bar", "pub", "fast_food", "bank", "pharmacy", "ice_cream", "theatre", "cinema"}


def fetch():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    for _ in range(8):
        try:
            req = urllib.request.Request("https://overpass-api.de/api/interpreter", body, {"User-Agent": "LifeLine-Prosperia/1.0"})
            with urllib.request.urlopen(req, timeout=200) as r:
                return json.load(r)["elements"]
        except (urllib.error.URLError, json.JSONDecodeError) as e:  # Overpass is often "too busy"; it clears up
            print("Overpass busy, retrying:", e)
            time.sleep(20)
    sys.exit("Overpass unavailable, try again later")


def xz(p):
    return round((p["lon"] - LNG0) * KX, 1), round((LAT0 - p["lat"]) * KZ, 1)


def line(geom):
    pts = []
    for p in map(xz, geom):
        if not pts or p != pts[-1]:
            pts.append(p)
    return pts


def area2(r):
    return sum(r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1] for i in range(len(r)))


def ring(geom, outer=True):  # outer rings wind with negative area2, holes positive: index.html's wall normals rely on it
    r = line(geom)
    if len(r) < 4 or r[0] != r[-1]:
        return None
    r.pop()
    return r if (area2(r) < 0) == outer else r[::-1]


def inside(r, x, z):
    c = False
    for (ax, az), (bx, bz) in zip(r, r[-1:] + r[:-1]):
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            c = not c
    return c


def runs(pts, lim=EXT + 150):  # split a polyline wherever it leaves the area
    run = []
    for p in pts + [None]:
        if p and abs(p[0]) < lim and abs(p[1]) < lim:
            run.append(p)
        else:
            if len(run) > 1:
                yield run
            run = []


def num(s):
    try:
        return float(str(s).split()[0])
    except ValueError:
        return 0


flat = lambda pts: [c for p in pts for c in p]
src = json.load(open(sys.argv[1]))["elements"] if len(sys.argv) > 1 else fetch()
out = {"ext": EXT, "b": [], "r": [], "a": [], "t": []}  # buildings, roads, areas, trees
for e in src:
    t = e.get("tags", {})
    if e["type"] == "node":
        out["t"] += xz(e)
    elif "building" in t:
        if t["building"] == "bridge" or num(t.get("layer", 0)) < 0:
            continue
        if e["type"] == "way":
            polys = [[ring(e["geometry"])]]
        else:  # multipolygon: closed member ways only; each hole goes to the outer that contains it
            m = [(x["role"], x.get("geometry")) for x in e["members"] if x.get("geometry")]
            polys = [[ring(g)] for role, g in m if role == "outer"]
            for h in (ring(g, False) for role, g in m if role == "inner"):
                for p in polys:
                    if h and p[0] and inside(p[0], *h[0]):
                        p.append(h)
                        break
        shop = int("shop" in t or t["building"] in ("retail", "commercial") or t.get("amenity") in SHOP_AMENITY)
        for p in polys:
            if p[0]:
                out["b"].append([t["building"], num(t.get("building:levels")), num(t.get("height")), shop, *map(flat, p)])
    elif "highway" in t:
        if t.get("tunnel") in ("yes", "building_passage"):
            continue
        for run in runs(line(e["geometry"])):
            out["r"].append([t["highway"], {"yes": 1, "-1": -1}.get(t.get("oneway"), 0), flat(run)])
    else:
        r = ring(e["geometry"])
        if r:
            out["a"].append([t.get("leisure") or t.get("landuse") or t.get("natural") or t.get("amenity"), flat(r)])

dst = pathlib.Path(__file__).with_name("chapel-hill.js")  # a plain script rather than JSON, so the page also opens from file://
dst.write_text("window.CHAPEL_HILL = " + json.dumps(out, separators=(",", ":")) + ";\n")
print(f"{dst}: {len(out['b'])} buildings, {len(out['r'])} roads, {len(out['a'])} areas, {len(out['t']) // 2} trees, {dst.stat().st_size / 1e6:.1f} MB")
