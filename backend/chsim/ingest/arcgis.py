"""ArcGIS REST adapter, following the dossier recipe: save layer metadata, count, list object IDs,
then fetch sorted ID batches. Works where offset pagination is unsupported. Read-only."""
from __future__ import annotations
import json
from pathlib import Path
import httpx
from .raw import RAW, _log, _now, sha256

BATCH = 200


def _get(url: str, **params) -> dict:
    r = httpx.get(url, params={"f": "json", **params}, timeout=120, follow_redirects=True)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(f"{url}: {data['error']}")
    return data


def fetch_layer(source_id: str, layer_url: str, out_fields: str = "*", geometry: bool = False,
                where: str = "1=1", refresh: bool = False, batch: int = BATCH) -> Path:
    folder = RAW / source_id
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / "features.json"
    if target.exists() and not refresh:
        return target
    meta = _get(layer_url)
    oid = meta.get("objectIdField") or next((f["name"] for f in meta.get("fields") or [] if f["type"] == "esriFieldTypeOID"), "OBJECTID")
    if out_fields != "*" and oid not in out_fields.split(","):
        out_fields = f"{oid},{out_fields}"  # needed for the completeness check
    count = _get(f"{layer_url}/query", where=where, returnCountOnly="true")["count"]
    ids = sorted(_get(f"{layer_url}/query", where=where, returnIdsOnly="true").get("objectIds") or [])
    features = []
    for i in range(0, len(ids), batch):
        chunk = ids[i:i + batch]
        page = httpx.post(f"{layer_url}/query", data={
            "f": "json", "objectIds": ",".join(map(str, chunk)), "outFields": out_fields,
            "returnGeometry": str(geometry).lower(), "outSR": "4326"}, timeout=180)
        page.raise_for_status()
        body = page.json()
        if "error" in body:
            raise RuntimeError(body["error"])
        features += body.get("features", [])
    distinct = len({f["attributes"].get(oid) for f in features})
    payload = {"layer_url": layer_url, "retrieved_at": _now(), "declared_count": count, "id_count": len(ids),
               "retrieved_distinct": distinct, "complete": distinct == count, "metadata": {
                   k: meta.get(k) for k in ("name", "description", "fields", "editingInfo", "objectIdField", "geometryType")},
               "features": features}
    target.write_text(json.dumps(payload))
    _log(source_id, {"url": layer_url, "file": target.name, "status": 200, "bytes": target.stat().st_size,
                     "sha256": sha256(target), "retrieved_at": payload["retrieved_at"],
                     "declared_count": count, "retrieved_distinct": distinct})
    if distinct != count:
        print(f"WARNING {source_id}: retrieved {distinct} distinct of {count} declared records")
    return target


def load_rows(path: Path) -> list[dict]:
    return [f["attributes"] | ({"_geometry": f["geometry"]} if f.get("geometry") else {})
            for f in json.loads(path.read_text())["features"]]
