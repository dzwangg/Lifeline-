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


def test_backend_files_are_not_served(client):
    assert client.get("/backend/chsim.db").status_code == 404
    assert client.get("/meridian-city/index.html").status_code == 200
    assert client.get("/data/baselines.json").status_code == 200
