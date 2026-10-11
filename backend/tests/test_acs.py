"""ACS refreshes (chsim.ingest.acs.build) never lose earlier observations and never report a partial refresh as complete."""
import json
import httpx
import pandas as pd
import pytest
from chsim.ingest import acs


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(acs, "PROCESSED", tmp_path)
    monkeypatch.setattr(acs, "RAW", tmp_path / "raw")
    monkeypatch.setattr(acs, "_log", lambda *a, **k: None)
    monkeypatch.setattr(acs, "YEARS", [2020])
    monkeypatch.setattr(acs, "REGION_COUNTIES", {"37135": "Orange"})
    monkeypatch.setenv("CENSUS_API_KEY", "test")
    # The previous refresh's file: one place row and one Orange tract row for 2020.
    pd.DataFrame([{"geoid": "3711800", "end_year": 2020, "window": "2016-2020", "var": "B01003_001", "estimate": 61000, "moe": 10},
                  {"geoid": "37135010100", "end_year": 2020, "window": "2016-2020", "var": "B01003_001", "estimate": 4000, "moe": 300}]
                 ).to_csv(tmp_path / "acs5_observations.csv", index=False)
    return tmp_path


def answer(geo):
    fields = ["NAME"] + [f"{v}{s}" for v in acs.VARS for s in ("E", "M")]
    if "tract" in geo["for"]:
        return [fields + ["state", "county", "tract"], ["t"] + ["5000"] * (len(fields) - 1) + ["37", "135", "010100"]]
    return [fields + ["state", "place"], ["p"] + ["62000"] * (len(fields) - 1) + ["37", "11800"]]


def test_a_failed_request_keeps_its_previous_rows_and_is_reported(sandbox, monkeypatch):
    def query(year, geo, key):
        if "place" in geo["for"]:
            raise httpx.ConnectError("census down")
        return answer(geo)
    monkeypatch.setattr(acs, "_query", query)
    status = acs.build()
    df = pd.read_csv(sandbox / "acs5_observations.csv", dtype={"geoid": str})
    place = df[(df.geoid == "3711800") & (df["var"] == "B01003_001")]
    assert list(place.estimate) == [61000], "the place's earlier observation survives the failed request"
    assert (df[df.geoid == "37135010100"].estimate == 5000).all(), "the tract is refreshed"
    assert status["status"] == "partial"
    assert status["missing"] == [{"end_year": 2020, "geography": "place", "kept_previous": True}]


def test_a_refresh_where_nothing_answers_leaves_the_file_alone(sandbox, monkeypatch):
    before = (sandbox / "acs5_observations.csv").read_text()
    monkeypatch.setattr(acs, "_query", lambda *a: (_ for _ in ()).throw(httpx.ConnectError("census down")))
    status = acs.build()
    assert (sandbox / "acs5_observations.csv").read_text() == before
    assert status["status"].startswith("error") and len(status["missing"]) == 2
    assert json.loads((sandbox / "acs_status.json").read_text())["status"] == status["status"]
