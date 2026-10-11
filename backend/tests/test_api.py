import os, time
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(os.path.dirname(__file__), "_test_api.db").replace("\\", "/")
os.environ["CHSIM_INLINE_WORKER"] = "1"
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    path = os.environ["DATABASE_URL"].removeprefix("sqlite:///")
    if os.path.exists(path):
        os.remove(path)
    from chsim.api.app import app
    with TestClient(app) as c:
        yield c


def wait(c, job_id, timeout=60):
    t = time.time()
    while time.time() - t < timeout:
        j = c.get(f"/api/jobs/{job_id}").json()
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.1)
    raise TimeoutError


def test_catalogs_and_metadata(client):
    assert len(client.get("/api/catalog/metrics").json()["metrics"]) >= 25
    p = client.get("/api/catalog/policies").json()
    assert set(p["ids"].values()) >= {"small-business-support-grant", "property-tax-adjustment"}
    assert client.get("/api/catalog/benchmarks").json()["peer_selection"]["status"] == "not assembled"
    assert "LODES" in client.get("/api/coverage").json()["report_markdown"]
    assert client.get("/api/model").json()["baseline"]["model"] == "persistence (no ML)"


def test_validation_reports_errors_and_warnings(client):
    bad = client.post("/api/scenarios/validate", json={"policies": {"hiring_subsidy": {"start_fy": 2031, "end_fy": 2028}}}).json()
    assert bad["valid"] is False and bad["errors"]
    warn = client.post("/api/scenarios/validate", json={"policies": {"hiring_subsidy": {"enabled": True, "funding_source": "unfunded"}}}).json()
    assert warn["valid"] and warn["warnings"]
    assert client.post("/api/jobs", json={"scenario": {"horizon_years": 7}}).status_code == 422


def test_job_flow_cache_and_distinct_hashes(client):
    s1 = {"draws": 100, "policies": {"hiring_subsidy": {"enabled": True}}}
    r = client.post("/api/jobs", json={"scenario": s1})
    assert r.status_code == 202
    j = wait(client, r.json()["job_id"])
    assert j["status"] == "done", j
    res = client.get(f"/api/results/{j['result_key']}").json()
    assert res["result_key"] == j["result_key"] and res["scenario"]["policies"]["hiring_subsidy"]["enabled"]
    again = client.post("/api/jobs", json={"scenario": s1}).json()
    assert again["cached"] and again["result_key"] == j["result_key"]
    # an edit gives a new hash and key: an older response can be recognised as stale by the client
    s2 = {**s1, "policies": {"hiring_subsidy": {"enabled": True, "annual_budget": 800000}}}
    k2 = client.post("/api/jobs", json={"scenario": s2}).json()
    assert k2["result_key"] != j["result_key"] and k2["scenario_hash"] != j["scenario_hash"]
    assert client.get(f"/api/scenarios/{j['scenario_hash']}/results").status_code == 200
    ex = client.get(f"/api/results/{j['result_key']}/explanation").json()
    assert ex["source"] in ("template",) or ex["source"].startswith("gemini")


def test_abandoned_running_job_is_requeued_and_finishes(client):
    from datetime import datetime, timedelta, timezone
    from chsim import jobs
    from chsim.sim.scenario import Scenario
    from chsim.store.db import session
    from chsim.store.models import Job
    sc = Scenario.model_validate({"draws": 100, "policies": {"small_business_support_grant": {"enabled": True, "annual_budget": 321000}}})
    old = datetime.now(timezone.utc) - timedelta(minutes=30)
    with session() as s:  # claimed by a worker that died half an hour ago: only the expiring claim can finish it
        jobs._insert_once(s, jobs.ScenarioRow, hash=sc.full_hash(), spec=sc.model_dump())
        s.add(Job(id="abandoned-job", scenario_hash=sc.full_hash(), result_key=jobs.result_key(sc), status="running",
                  progress=.4, created_at=old, updated_at=old))
    assert wait(client, "abandoned-job")["status"] == "done"


def test_identical_records_insert_once(client):
    from chsim import jobs
    from chsim.store.db import session
    from chsim.store.models import Scenario as ScenarioRow, ScenarioResult
    for _ in range(2):  # the second write of each is a no-op, not an IntegrityError
        with session() as s:
            jobs._insert_once(s, ScenarioRow, hash="z" * 64, spec={"policies": {}})
            jobs._insert_once(s, ScenarioResult, result_key="y" * 64, scenario_hash="z" * 64, payload={"first": True})
    assert jobs.result("y" * 64) == {"first": True}


def test_backend_files_are_not_served(client):
    assert client.get("/backend/chsim.db").status_code == 404
    assert client.get("/meridian-city/index.html").status_code == 200
    assert client.get("/data/baselines.json").status_code == 200
