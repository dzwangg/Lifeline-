"""FastAPI service.  uvicorn chsim.api.app:app --port 8000   (from backend/)

Serves the API under /api and, for local development, the static site (repo root) so /meridian-city/ works.
Set CHSIM_INLINE_WORKER=0 when running a separate `python -m chsim.worker`.
"""
from __future__ import annotations
import json, os, threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from ..config import PROCESSED, REPO, DATA_VERSION, EFFECTS_VERSION, BENCHMARK_VERSION
from ..store.db import init_db, session
from ..store.models import SourceAsset
from ..sim.baseline import load_current
from ..sim.scenario import Scenario, Policies, Targets, CARD_IDS
from ..sim.catalog import METRICS, FAMILIES
from ..sim.assumptions import describe
from ..sim.benchmarks import PEER_SELECTION
from ..sim.explain import CARD_TEXT
from .. import jobs
from .integrations import gemini_explanation, nessie_synthetic_ledger

_stop = threading.Event()


@asynccontextmanager
async def lifespan(app):
    init_db()
    t = None
    if os.environ.get("CHSIM_INLINE_WORKER", "1") == "1":
        t = threading.Thread(target=jobs.run_worker, kwargs={"stop": _stop}, daemon=True)
        t.start()
    yield
    _stop.set()


app = FastAPI(title="Chapel Hill policy simulator", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("CHSIM_CORS", "*").split(","), allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    return {"ok": True, "model_version": jobs.model_version()}


@app.get("/api/catalog/metrics")
def metrics_catalog():
    return {"families": FAMILIES, "metrics": METRICS}


@app.get("/api/catalog/policies")
def policies_catalog():
    return {"schema": Policies.model_json_schema(), "defaults": Policies().model_dump(), "ids": CARD_IDS, "cards": CARD_TEXT,
            "assumptions": describe()}


@app.get("/api/catalog/benchmarks")
def benchmarks_catalog():
    return {"version": BENCHMARK_VERSION, "defaults": Targets().model_dump(), "peer_selection": PEER_SELECTION,
            "note": "Illustrative targets: goals, not causal counterfactuals."}


@app.get("/api/coverage")
def coverage():
    with session() as s:
        assets = [{c: getattr(a, c) for c in ("source_id", "title", "url", "file", "sha256", "retrieved_at", "access_result")}
                  for a in s.query(SourceAsset).all()]
    return {"data_version": DATA_VERSION, "sources": assets,
            "evidence": json.loads((PROCESSED / "local_evidence.json").read_text()),
            "acs": json.loads((PROCESSED / "acs_status.json").read_text()),
            "report_markdown": (REPO / "docs" / "data-coverage.md").read_text(encoding="utf-8")}


@app.get("/api/model")
def model():
    meta, _ = load_current()
    return {"baseline": meta, "effects_version": EFFECTS_VERSION}


def _parse(body: dict) -> Scenario:
    try:
        return Scenario.model_validate(body)
    except ValidationError as e:
        raise HTTPException(422, detail=json.loads(e.json()))


@app.post("/api/scenarios/validate")
def validate(body: dict):
    try:
        sc = Scenario.model_validate(body)
    except ValidationError as e:
        return {"valid": False, "errors": json.loads(e.json()), "warnings": []}
    return {"valid": True, "errors": [], "warnings": sc.validation_warnings(), "scenario_hash": sc.full_hash(), "sim_hash": sc.sim_hash()}


@app.post("/api/scenarios")
def create_scenario(body: dict):
    sc = _parse(body)
    return {"scenario_hash": sc.full_hash(), "sim_hash": sc.sim_hash(), "scenario": sc.model_dump()}


@app.post("/api/jobs", status_code=202)
def submit(body: dict):
    sc = _parse(body.get("scenario", body))
    return jobs.submit(sc)


@app.get("/api/jobs/{job_id}")
def job(job_id: str):
    j = jobs.status(job_id)
    if j is None:
        raise HTTPException(404, "unknown job")
    return j


@app.get("/api/results/{result_key}")
def result(result_key: str):
    r = jobs.result(result_key)
    if r is None:
        raise HTTPException(404, "result not ready")
    return r


@app.get("/api/scenarios/{scenario_hash}/results")
def scenario_results(scenario_hash: str):
    r = jobs.latest_result_for_scenario(scenario_hash)
    if r is None:
        raise HTTPException(404, "no results for this scenario yet")
    return r


@app.get("/api/results/{result_key}/explanation")
def explanation(result_key: str):
    r = jobs.result(result_key)
    if r is None:
        raise HTTPException(404, "result not ready")
    return gemini_explanation(r)


@app.post("/api/results/{result_key}/nessie-demo")
def nessie(result_key: str):
    r = jobs.result(result_key)
    if r is None:
        raise HTTPException(404, "result not ready")
    return nessie_synthetic_ledger(r)


if os.environ.get("CHSIM_SERVE_SITE", "1") == "1":
    # Only the folders the static site loads; backend/ (venv, raw data, database) is never served.
    for sub in ("meridian-city", "data", "shared", "tests/fixtures"):
        app.mount(f"/{sub}", StaticFiles(directory=str(REPO / sub), html=True), name=sub.replace("/", "_"))

    @app.get("/")
    def root():
        from fastapi.responses import RedirectResponse
        return RedirectResponse("/meridian-city/")
