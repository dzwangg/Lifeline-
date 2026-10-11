"""Simulation job queue backed by the `job` table (works with SQLite locally or Postgres in deployment).

submit() returns at once; a worker (python -m chsim.worker, or the API's inline thread) claims queued jobs and stores
results keyed by scenario + model + data + effects + benchmark versions, so repeated requests are served from cache.
"""
from __future__ import annotations
import hashlib, json, threading, time, uuid
from sqlalchemy import select, update
from .config import DATA_VERSION, EFFECTS_VERSION, BENCHMARK_VERSION
from .store.db import session, init_db
from .store.models import Job, Scenario as ScenarioRow, ScenarioResult
from .sim.scenario import Scenario
from .sim.baseline import load_current


def model_version() -> str:
    return load_current()[0]["model_version"]


def result_key(sc: Scenario) -> str:
    raw = "|".join([sc.full_hash(), model_version(), DATA_VERSION, EFFECTS_VERSION, BENCHMARK_VERSION])
    return hashlib.sha256(raw.encode()).hexdigest()


def submit(sc: Scenario) -> dict:
    key = result_key(sc)
    with session() as s:
        if s.get(ScenarioRow, sc.full_hash()) is None:
            s.add(ScenarioRow(hash=sc.full_hash(), spec=sc.model_dump()))
        cached = s.get(ScenarioResult, key) is not None
        job = Job(id=str(uuid.uuid4()), scenario_hash=sc.full_hash(), result_key=key,
                  status="done" if cached else "queued", progress=1.0 if cached else 0.0,
                  message="served from cache" if cached else None)
        s.add(job)
    return {"job_id": job.id, "status": job.status, "result_key": key, "scenario_hash": sc.full_hash(), "cached": cached}


def status(job_id: str) -> dict | None:
    with session() as s:
        j = s.get(Job, job_id)
        return None if j is None else {"job_id": j.id, "status": j.status, "progress": j.progress, "message": j.message,
                                       "result_key": j.result_key, "scenario_hash": j.scenario_hash}


def result(key: str) -> dict | None:
    with session() as s:
        r = s.get(ScenarioResult, key)
        return None if r is None else r.payload


def latest_result_for_scenario(scenario_hash: str) -> dict | None:
    with session() as s:
        r = s.scalars(select(ScenarioResult).where(ScenarioResult.scenario_hash == scenario_hash)
                      .order_by(ScenarioResult.created_at.desc())).first()
        return None if r is None else r.payload


def _claim() -> Job | None:
    with session() as s:
        j = s.scalars(select(Job).where(Job.status == "queued").order_by(Job.created_at)).first()
        if j is None:
            return None
        n = s.execute(update(Job).where(Job.id == j.id, Job.status == "queued").values(status="running", progress=0.01)).rowcount
        return j if n else None


def _set(job_id: str, **kw) -> None:
    with session() as s:
        s.execute(update(Job).where(Job.id == job_id).values(**kw))


def work_once() -> bool:
    from .sim.paired import run_scenario
    j = _claim()
    if j is None:
        return False
    try:
        with session() as s:
            spec = s.get(ScenarioRow, j.scenario_hash).spec
        sc = Scenario.model_validate(spec)
        if result(j.result_key) is None:
            payload = run_scenario(sc, progress=lambda f, msg="": _set(j.id, progress=round(f, 3), message=msg))
            payload = json.loads(json.dumps(payload, default=float))
            payload["result_key"] = j.result_key
            with session() as s:
                if s.get(ScenarioResult, j.result_key) is None:
                    s.add(ScenarioResult(result_key=j.result_key, scenario_hash=j.scenario_hash, payload=payload))
        _set(j.id, status="done", progress=1.0, message="done")
    except Exception as e:  # surfaced to the client; never silently swallowed
        _set(j.id, status="error", message=f"{type(e).__name__}: {e}")
    return True


def run_worker(poll: float = 0.2, stop: threading.Event | None = None) -> None:
    init_db()
    while not (stop and stop.is_set()):
        if not work_once():
            time.sleep(poll)
