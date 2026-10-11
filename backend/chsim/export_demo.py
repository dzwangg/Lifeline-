"""Precompute the demonstration scenarios (developer prompt section 11) for the static site.

python -m chsim.export_demo   -> data/forecast/demo/<id>.json, data/forecast/demo/index.json, data/forecast/catalog.json
The website labels these "precomputed demo" and uses them when no API is reachable.
"""
from __future__ import annotations
import json
from .config import SITE_DATA
from .sim.baseline import load_current
from .sim.scenario import Scenario, Policies, Targets, CARD_IDS
from .sim.paired import run_scenario
from .sim.catalog import METRICS, FAMILIES
from .sim.assumptions import describe
from .sim.benchmarks import PEER_SELECTION
from .sim.explain import CARD_TEXT
from .api.integrations import template_explanation

DEMOS = {
    "current-policies": ("Unchanged current policies", {}),
    "small-business-support": ("Small-business support", {
        "small_business_support_grant": {"enabled": True, "start_fy": 2027, "end_fy": 2029, "annual_budget": 500000,
                                         "grant_per_establishment": 10000}}),
    "hiring-subsidy": ("Hiring subsidy", {
        "hiring_subsidy": {"enabled": True, "start_fy": 2027, "end_fy": 2028, "annual_budget": 400000, "subsidy_per_hire": 5000}}),
    "delayed-affordable-housing": ("Delayed affordable-housing subsidy", {
        "housing_construction_subsidy": {"enabled": True, "start_fy": 2029, "end_fy": 2031, "annual_budget": 2000000,
                                         "award_per_unit": 40000, "affordable_share": 0.6, "affordability_term_years": 30}}),
    "combined-tax-funded": ("Combined package funded by a property-tax increase", {
        "small_business_support_grant": {"enabled": True, "funding_source": "tax_adjustment"},
        "new_business_startup_grant": {"enabled": True, "funding_source": "tax_adjustment"},
        "hiring_subsidy": {"enabled": True, "funding_source": "tax_adjustment"},
        "housing_construction_subsidy": {"enabled": True, "start_fy": 2028, "end_fy": 2031, "funding_source": "tax_adjustment"},
        "property_tax_adjustment": {"enabled": True, "change_cents_per_100": 2.5, "start_fy": 2027}}),
}


def run() -> None:
    out = SITE_DATA / "demo"
    out.mkdir(parents=True, exist_ok=True)
    index = []
    for sid, (name, pol) in DEMOS.items():
        sc = Scenario.model_validate({"name": name, "policies": pol})
        r = json.loads(json.dumps(run_scenario(sc), default=float))
        r["demo_id"] = sid
        r["explanation"] = {"source": "template", "text": template_explanation(r)}
        (out / f"{sid}.json").write_text(json.dumps(r, separators=(",", ":")))
        index.append({"id": sid, "name": name, "scenario": sc.model_dump(), "scenario_hash": sc.full_hash()})
        print(f"{sid}: {len(json.dumps(r)) / 1e3:.0f} kB")
    meta, _ = load_current()
    (out / "index.json").write_text(json.dumps({"label": "precomputed demo", "model_version": meta["model_version"],
                                                "scenarios": index}, indent=1))
    (SITE_DATA / "catalog.json").write_text(json.dumps({
        "families": FAMILIES, "metrics": METRICS, "policy_defaults": Policies().model_dump(),
        "policy_schema": Policies.model_json_schema(), "card_ids": CARD_IDS, "cards": CARD_TEXT,
        "assumptions": describe(), "targets": Targets().model_dump(), "peer_selection": PEER_SELECTION,
        "model": meta}, indent=1))


if __name__ == "__main__":
    run()
