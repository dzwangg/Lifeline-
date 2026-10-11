"""Immutable raw snapshots: every download is stored once with its hash, URL and retrieval time.

Layout: data/raw/<source_id>/<filename> plus data/raw/<source_id>/manifest.jsonl.
An existing snapshot is reused, never overwritten; pass refresh=True to add a dated copy.
"""
from __future__ import annotations
import hashlib, json, time
from datetime import datetime, timezone
from pathlib import Path
import httpx
from ..config import RAW


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def manifest(source_id: str) -> list[dict]:
    p = RAW / source_id / "manifest.jsonl"
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def fetch(source_id: str, url: str, filename: str | None = None, refresh: bool = False, retries: int = 3) -> Path:
    folder = RAW / source_id
    folder.mkdir(parents=True, exist_ok=True)
    filename = filename or url.rsplit("/", 1)[-1]
    target = folder / filename
    if target.exists() and not refresh:
        return target
    if target.exists():  # keep the old snapshot; the new one gets a dated name
        target = folder / f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S}_{filename}"
    tmp = target.with_suffix(target.suffix + ".part")
    for attempt in range(retries):
        try:
            with httpx.stream("GET", url, timeout=120, follow_redirects=True) as r:
                status = r.status_code
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        f.write(chunk)
            break
        except httpx.HTTPError as e:
            if attempt == retries - 1:
                _log(source_id, {"url": url, "file": None, "status": "error", "error": str(e), "retrieved_at": _now()})
                raise
            time.sleep(2 ** attempt)
    tmp.replace(target)
    _log(source_id, {"url": url, "file": target.name, "status": status, "bytes": target.stat().st_size,
                     "sha256": sha256(target), "retrieved_at": _now()})
    return target


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _log(source_id: str, entry: dict) -> None:
    with open(RAW / source_id / "manifest.jsonl", "a") as f:
        f.write(json.dumps(entry) + "\n")
