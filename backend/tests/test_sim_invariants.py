"""Required integration/invariant tests (developer prompt section 11)."""
import dataclasses, json
import numpy as np
import pandas as pd
import pytest
from chsim.config import PROCESSED
from chsim.sim.scenario import Scenario
from chsim.sim.paired import run_scenario, shared_inputs, anchors
from chsim.sim.engine import run_path


def sc(policies=None, **kw):
    return Scenario.model_validate({"draws": 100, "policies": policies or {}, **kw})


def paths(s: Scenario, anchor_overrides=None, param_overrides=None):
    sh, _ = shared_inputs(s)
    for k, v in (param_overrides or {}).items():
        sh.p[k] = np.full(s.draws, float(v))
    a = dataclasses.replace(anchors(), **(anchor_overrides or {}))
    return run_path(s.reference(), sh, a, s.seed), run_path(s, sh, a, s.seed)


def test_no_policy_changes_give_exactly_zero_deltas():
    r = run_scenario(sc(horizon_years=10), attribution=False)
    for m in r["metrics"]:
        for row in m["series"]:
            assert all(v == 0.0 for v in row["delta"].values()), m["id"]


def test_enabled_but_neutral_tax_card_gives_zero_deltas():
    base, sel = paths(sc({"property_tax_adjustment": {"enabled": True, "change_cents_per_100": 0}}))
    for k in base:
        assert np.array_equal(base[k], sel[k]), k


def test_replay_is_identical_for_same_scenario_and_seed():
    s = sc({"hiring_subsidy": {"enabled": True}, "housing_construction_subsidy": {"enabled": True}})
    a, b = run_scenario(s), run_scenario(s)
    assert json.dumps(a, sort_keys=True, default=float) == json.dumps(b, sort_keys=True, default=float)
    c = run_scenario(s.model_copy(update={"seed": s.seed + 1}))
    assert json.dumps(a["metrics"], default=float) != json.dumps(c["metrics"], default=float)


def test_one_cent_on_one_billion_is_100k_gross_levy():
    s = sc({"property_tax_adjustment": {"enabled": True, "change_cents_per_100": 1.0}})
    base, sel = paths(s, {"taxable_base": 1e9}, {"base_growth_nominal": 0.0})
    d = sel["tax_levy_gross"][:, 0] - base["tax_levy_gross"][:, 0]
    assert np.allclose(d, 100_000.0, atol=1e-6)
    # receipts apply the collection rate on top of the arithmetic levy
    assert np.allclose(sel["receipts_property_tax"][:, 0] - base["receipts_property_tax"][:, 0], 100_000 * sel["receipts_property_tax"][:, 0] / sel["tax_levy_gross"][:, 0])


def test_tax_duration_and_effective_year():
    s = sc({"property_tax_adjustment": {"enabled": True, "change_cents_per_100": 2.0, "start_fy": 2028, "duration_years": 2}})
    base, sel = paths(s)
    d = np.median(sel["tax_levy_gross"] - base["tax_levy_gross"], 0)
    assert d[0] == 0 and d[1] > 0 and d[2] > 0 and d[3] == 0 and d[4] == 0


def test_housing_appears_only_after_modelled_completions():
    s = sc({"housing_construction_subsidy": {"enabled": True, "start_fy": 2027, "end_fy": 2027}})
    base, sel = paths(s)
    assert np.all(sel["housing_completed_new"][:, 0] == 0), "no same-year homes"
    assert np.allclose(sel["housing_net_stock_change"], np.cumsum(sel["housing_completed_new"], 1))
    assert np.all(sel["housing_completed_new"] <= sel["housing_completed_funded"] + 1e-9)
    assert np.median(sel["housing_net_stock_change"][:, -1]) > 0


def test_preservation_restricts_but_creates_no_units():
    s = sc({"housing_construction_subsidy": {"enabled": True, "preservation_share": 1.0}})
    base, sel = paths(s)
    assert np.all(sel["housing_net_stock_change"] == 0)
    assert np.median(sel["restricted_stock"][:, -1] - base["restricted_stock"][:, -1]) > 0
    assert np.median(sel["restricted_preserved"].sum(1)) > 0


def test_restrictions_expire_on_schedule():
    s = sc({"housing_construction_subsidy": {"enabled": True, "start_fy": 2027, "end_fy": 2027, "affordability_term_years": 2}},
           horizon_years=10)
    _, sel = paths(s)
    added = sel["restricted_new_completed"] + sel["restricted_preserved"]
    for m in range(5):
        for h in np.nonzero(added[m])[0]:
            if h + 2 < added.shape[1]:
                assert sel["restricted_expired"][m, h + 2] >= added[m, h] - 1e-9
    assert np.allclose(sel["restricted_stock"][:, -1], anchors().restricted_units)  # everything added has expired


def test_startup_openings_are_delayed_one_year():
    s = sc({"new_business_startup_grant": {"enabled": True, "start_fy": 2028, "end_fy": 2028}})
    _, sel = paths(s)
    assert np.all(sel["openings_new"][:, :2] == 0)
    assert np.all(sel["openings_new"][:, 2] > 0)
    assert np.all(sel["openings_new"][:, 3:] == 0)


def test_hiring_retention_after_support_ends():
    s = sc({"hiring_subsidy": {"enabled": True, "start_fy": 2027, "end_fy": 2027, "duration_months": 12}})
    base, sel = paths(s, param_overrides={"hire_retention_after": 0.5, "hire_separation_later": 0.2})
    d = sel["workplace_jobs"] - base["workplace_jobs"]
    assert np.allclose(d[:, 1], 0.5 * d[:, 0])
    assert np.allclose(d[:, 2], 0.8 * d[:, 1])


def test_mixed_policies_respect_budgets_capacity_and_shared_funds():
    s = sc({"small_business_support_grant": {"enabled": True, "funding_source": "fund_balance"},
            "hiring_subsidy": {"enabled": True, "funding_source": "fund_balance"},
            "housing_construction_subsidy": {"enabled": True, "annual_budget": 50_000_000, "funding_source": "fund_balance"}},
           reserve_floor_pct=20)
    base, sel = paths(s)
    assert np.all(sel["sbg_paid"] <= 500_000 + 1e-6) and np.all(sel["hire_paid"] <= 400_000 + 1e-6)
    hs_units = (sel["hs_paid"] > 0)
    assert hs_units.any()
    assert np.all(sel["hs_unmet"][:, 0] > 0), "a $50M request exceeds capacity or funds"
    assert np.all(sel["fund_balance"] >= -1e-6), "no borrowing: reserves never go negative"


def test_unfunded_policy_shows_gap_and_spends_nothing():
    s = sc({"hiring_subsidy": {"enabled": True, "funding_source": "unfunded"}})
    base, sel = paths(s)
    assert np.all(sel["hire_paid"] == 0)
    assert np.all(sel["funding_gap"][:, :3] > 0)
    assert any("unfunded" in w for w in s.validation_warnings())


def test_tax_funded_card_without_tax_increase_is_capped():
    s = sc({"hiring_subsidy": {"enabled": True, "funding_source": "tax_adjustment"}})
    _, sel = paths(s)
    assert np.all(sel["hire_paid"] == 0) and np.all(sel["funding_gap"][:, 0] > 0)
    assert s.validation_warnings()


def test_targets_do_not_change_the_simulation():
    p = {"housing_construction_subsidy": {"enabled": True}}
    a = run_scenario(sc(p), attribution=False)
    b = run_scenario(sc(p, targets={"workplace_jobs_growth_pct_per_year": 5, "restricted_share_of_stock_pct": 25}), attribution=False)
    assert a["sim_hash"] == b["sim_hash"]
    for ma, mb in zip(a["metrics"], b["metrics"]):
        for ra, rb in zip(ma["series"], mb["series"]):
            assert ra["delta"] == rb["delta"] and ra["policy"] == rb["policy"]


def test_units_calendars_and_percentage_points():
    r = run_scenario(sc({"hiring_subsidy": {"enabled": True}}), attribution=False)
    assert r["fiscal_years"] == [f"FY{y}" for y in r["years"]] and r["dollars"] == "nominal"
    pct = [m for m in r["metrics"] if m["kind"] == "percent" and m["supported"]]
    assert pct and all(m["delta_unit"] == "percentage points" for m in pct)
    assert all(row["delta_relative_pct"] is None for m in pct for row in m["series"])


def test_missing_labels_are_unavailable_not_zero():
    r = run_scenario(sc(), attribution=False)
    by = {m["id"]: m for m in r["metrics"]}
    assert by["renter_burden"]["supported"] is False and by["renter_burden"]["series"] == []
    assert by["establishments_change"]["level"] == "unavailable"


def test_cost_ratios_suppressed_when_denominator_not_positive():
    r = run_scenario(sc({"property_tax_adjustment": {"enabled": True, "change_cents_per_100": 1}}), attribution=False)
    assert r["cost_effectiveness"]["per_additional_job"]["suppressed"] is True


def test_town_job_identity_in_processed_lodes():
    t = pd.read_csv(PROCESSED / "lodes_town_year.csv")
    assert (t.workplace_jobs == t.residents_working_in_town + t.in_commuters_from_nc + t.in_commuters_from_out_of_state).all()


def test_paired_intervals_come_from_paired_draws():
    r = run_scenario(sc({"hiring_subsidy": {"enabled": True}}), attribution=False)
    jobs = next(m for m in r["metrics"] if m["id"] == "workplace_jobs")["series"][0]
    naive = jobs["policy"]["p90"] - jobs["baseline"]["p10"]
    assert jobs["delta"]["p90"] < naive  # paired interval is much tighter than subtracting marginal quantiles


def test_invalid_scenarios_are_rejected():
    with pytest.raises(Exception):
        Scenario.model_validate({"policies": {"hiring_subsidy": {"start_fy": 2030, "end_fy": 2028}}})
    with pytest.raises(Exception):
        Scenario.model_validate({"policies": {"property_tax_adjustment": {"change_cents_per_100": 40}}})
