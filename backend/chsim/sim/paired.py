"""Paired simulation (developer prompt section 7) and result summaries (sections 8 and 10).

For each draw m the baseline (reference actions) and selected paths reuse the same baseline jobs path, macro path,
sampled parameters and random streams. Intervals for levels and for paired differences are computed directly from the
draws; marginal quantiles are never subtracted. Targets are applied after simulation.
"""
from __future__ import annotations
import json
from functools import lru_cache
import numpy as np
from ..config import PROCESSED, BACKEND, REPO, DATA_VERSION, EFFECTS_VERSION, BENCHMARK_VERSION, LAST_OBSERVED_YEAR
from .baseline import load_current
from .assumptions import sample_all, describe, PARAMS
from .benchmarks import target_paths, PEER_SELECTION
from .catalog import METRICS, BY_ID, FAMILIES
from .engine import Anchors, Shared, run_path
from .scenario import Scenario, CARD_IDS, ORIGIN_YEAR
from .explain import CARD_TEXT

Q = [0.025, 0.1, 0.5, 0.9, 0.975]
MACRO = {  # disclosed scenario assumptions: log shift to baseline jobs, and shift to nominal base growth, by projection year
    "central": ([0.0] * 10, [0.0] * 10),
    "adverse": ([-0.03, -0.05, -0.05, -0.04, -0.03, -0.02, -0.01, 0, 0, 0], [-0.01, -0.01, -0.005, 0, 0, 0, 0, 0, 0, 0]),
    "optimistic": ([0.02, 0.03, 0.03, 0.03, 0.02, 0.02, 0.01, 0.01, 0, 0], [0.005, 0.005, 0, 0, 0, 0, 0, 0, 0, 0]),
}
KEY_METRICS = ["workplace_jobs", "resident_jobs", "establishments_change", "housing_net_stock_change", "restricted_stock",
               "median_gross_rent", "receipts_property_tax", "operating_balance", "fund_balance", "funding_gap"]


@lru_cache(maxsize=1)
def anchors() -> Anchors:
    ev = json.loads((PROCESSED / "local_evidence.json").read_text())
    base = json.loads((REPO / "data" / "baselines.json").read_text())
    fil = json.loads((BACKEND / "data" / "assumptions" / "fiscal_illustrative.json").read_text())
    return Anchors(
        taxable_base=ev["taxable_base"]["town_taxable_assessed_value"],
        restricted_units=ev["restricted_inventory"]["restricted_units_chapel_hill"],
        housing_units=base["housingUnits"]["value"],
        median_gross_rent=base["medianGrossRent"]["value"],
        sales_tax=fil["sales_tax_distribution"]["value"],
        other_receipts=fil["other_comparable_receipts"]["value"],
        fund_balance_pct=fil["fund_balance_pct_of_expenditure"]["value"],
        housing_lags=ev["housing_grants"]["development_completion_lag_years"],
    )


def shared_inputs(sc: Scenario) -> tuple[Shared, dict]:
    meta, f = load_current()
    years_all = [int(y) for y in f["years"]]
    M, H = sc.draws, sc.horizon_years
    idx = np.arange(M) % f["town_jobs"].shape[0]
    cols = [years_all.index(y) for y in sc.years]
    shift_jobs, shift_growth = (np.array(v[:H]) for v in MACRO[sc.macro])
    jobs = f["town_jobs"][idx][:, cols] * np.exp(shift_jobs)[None]
    rac = f["town_rac"][idx][:, cols] * np.exp(shift_jobs)[None]
    o = years_all.index(ORIGIN_YEAR)
    return Shared(years=sc.years, jobs=jobs.astype(float), rac=rac.astype(float), origin_jobs=f["town_jobs"][idx, o].astype(float),
                  origin_rac=f["town_rac"][idx, o].astype(float), p=sample_all(M, sc.seed), macro_growth_shift=shift_growth), {
        "meta": meta, "f": f, "years_all": years_all}


def qs(x: np.ndarray) -> dict:
    v = np.quantile(x, Q, axis=0)
    return {"p2_5": v[0], "p10": v[1], "p50": v[2], "p90": v[3], "p97_5": v[4], "mean": x.mean(0)}


def _ser(d: dict, h: int) -> dict:
    return {k: float(np.round(v[h], 4)) for k, v in d.items()}


def run_scenario(sc: Scenario, progress=lambda f, msg="": None, attribution=True) -> dict:
    progress(0.05, "sampling shared inputs")
    sh, fc = shared_inputs(sc)
    a = anchors()
    progress(0.15, "baseline path")
    base = run_path(sc.reference(), sh, a, sc.seed)
    progress(0.35, "selected-policy path")
    sel = run_path(sc, sh, a, sc.seed)
    progress(0.55, "summarising")
    payload = summarize(sc, sh, a, base, sel, fc)
    enabled = [k for k, c in sc.policies if c.enabled]
    if attribution and len(enabled) >= 2:
        progress(0.65, "removal attribution")
        payload["attribution"] = removal_attribution(sc, sh, a, base, sel, enabled)
    progress(1.0, "done")
    return payload


def removal_attribution(sc, sh, a, base, sel, enabled) -> dict:
    """Contribution of card k = full scenario minus the scenario with card k removed (paired, same draws).
    With interactions (shared budgets, capacity) contributions need not add up to the total."""
    rows = {}
    for k in enabled:
        pol = sc.policies.model_copy(update={k: getattr(sc.policies, k).model_copy(update={"enabled": False})})
        without = run_path(sc.model_copy(update={"policies": pol}), sh, a, sc.seed)
        rows[CARD_IDS[k]] = {m: float(np.median(sel[m][:, -1] - without[m][:, -1])) for m in KEY_METRICS}
    total = {m: float(np.median(sel[m][:, -1] - base[m][:, -1])) for m in KEY_METRICS}
    return {"method": "removal comparison (final year, median of paired differences)", "by_card": rows, "total": total,
            "note": "Contributions can sum to more or less than the total when cards share budgets, reserves or capacity."}


def summarize(sc: Scenario, sh: Shared, a: Anchors, base: dict, sel: dict, fc: dict) -> dict:
    H, years = len(sc.years), sc.years
    origin = {"workplace_jobs": float(np.median(sh.origin_jobs)), "resident_jobs": float(np.median(sh.origin_rac))}
    targets = target_paths(sc.targets, years, origin, a.housing_units)
    metrics = []
    for m in METRICS:
        entry = {k: m[k] for k in ("id", "family", "label", "unit", "kind", "favorable", "level", "effect", "note", "show")}
        if m["id"] not in sel:
            entry.update(supported=False, series=[], target=targets.get(m["id"], {}).get("label"))
            metrics.append(entry)
            continue
        b, s = base[m["id"]], sel[m["id"]]
        d = s - b
        qb, qsel, qd = qs(b), qs(s), qs(d)
        rel_ok = m["kind"] in ("count", "currency") and m["level"] not in ("unavailable",) and (b > 0).all()
        qrel = qs(d / np.where(b > 0, b, 1) * 100) if rel_ok else None
        tgt = targets.get(m["id"])
        series = []
        for h in range(H):
            row = {"year": years[h], "fiscal_year": f"FY{years[h]}", "baseline": _ser(qb, h), "policy": _ser(qsel, h),
                   "delta": _ser(qd, h), "delta_relative_pct": _ser(qrel, h) if qrel else None}
            if tgt is not None:
                gap = (s[:, h] - tgt["values"][h]) if tgt["kind"] == "threshold_min" else (tgt["values"][h] - s[:, h])
                row["target"] = float(tgt["values"][h])
                row["gap_to_target"] = _ser(qs(gap[:, None]), 0)  # positive = meets target (by that margin)
            series.append(row)
        entry.update(supported=True, series=series, target=tgt["label"] if tgt else None,
                     target_kind=tgt["kind"] if tgt else None, delta_unit="percentage points" if m["kind"] == "percent" else m["unit"])
        metrics.append(entry)

    f, ya = fc["f"], fc["years_all"]
    history = _history()
    nowcast = {"years": [y for y in ya if y <= ORIGIN_YEAR],
               "workplace_jobs": [_ser(qs(f["town_jobs"][:, [i]]), 0) for i, y in enumerate(ya) if y <= ORIGIN_YEAR],
               "resident_jobs": [_ser(qs(f["town_rac"][:, [i]]), 0) for i, y in enumerate(ya) if y <= ORIGIN_YEAR]}

    # representative optimistic / adverse response draws: 90th / 10th percentile of the final-year jobs change
    dj = sel["workplace_jobs"][:, -1] - base["workplace_jobs"][:, -1]
    order = np.argsort(dj)
    reps = {}
    for name, q in (("adverse", 0.1), ("optimistic", 0.9)):
        m_ = int(order[int(q * (len(order) - 1))])
        reps[name] = {"draw": m_, "params": {k: float(v[m_]) for k, v in sh.p.items()},
                      "delta": {k: [float(x) for x in (sel[k][m_] - base[k][m_])] for k in KEY_METRICS}}

    return {
        "scenario": sc.model_dump(), "scenario_hash": sc.full_hash(), "sim_hash": sc.sim_hash(),
        "years": years, "fiscal_years": [f"FY{y}" for y in years],
        "fiscal_year_rule": "FY t runs July (t-1) to June t; spending in FY t first affects calendar year t.",
        "time_status": {"last_observed": LAST_OBSERVED_YEAR, "nowcast": nowcast["years"], "projected": years},
        "dollars": "nominal",
        "draws": sc.draws, "seed": sc.seed,
        "families": FAMILIES, "metrics": metrics,
        "history": history, "nowcast": nowcast,
        "policies": _policy_summary(sc, base, sel),
        "ledger": _ledger(base, sel, years),
        "cost_effectiveness": _cost_effectiveness(base, sel),
        "representative_draws": reps,
        "benchmark": {"version": BENCHMARK_VERSION, "peer_selection": PEER_SELECTION,
                      "note": "Targets are goals, not causal counterfactuals; gaps to target are not policy effects."},
        "assumptions": describe(),
        "anchors": {"taxable_base_fy2026": a.taxable_base, "restricted_units_fy2025": a.restricted_units,
                    "housing_units_2020_verify": a.housing_units, "median_gross_rent_acs_2019_2023": a.median_gross_rent,
                    "illustrative_fiscal": {"sales_tax": a.sales_tax, "other_receipts": a.other_receipts,
                                            "fund_balance_pct": a.fund_balance_pct}},
        "warnings": sc.validation_warnings() + _result_warnings(sel),
        "lineage": {"data_version": DATA_VERSION, "model_version": fc["meta"]["model_version"], "model": fc["meta"]["model"],
                    "effects_version": EFFECTS_VERSION, "benchmark_version": BENCHMARK_VERSION,
                    "policy_schema": sc.schema_version, "sources": ["S24", "S02", "S05", "S06", "S13", "S16"]},
        "label": "Sensitivity simulation: policy effects are assumption-based, not validated local causal predictions.",
    }


@lru_cache(maxsize=1)
def _history() -> dict:
    import pandas as pd
    t = pd.read_csv(PROCESSED / "lodes_town_year.csv")
    return {"years": t.year.tolist(), "workplace_jobs": t.workplace_jobs.tolist(), "resident_jobs": t.resident_primary_jobs.tolist(),
            "source": "LODES8 JT01 (S24), 2020 Chapel Hill place blocks", "status": "observed"}


def _policy_summary(sc: Scenario, base, sel) -> list[dict]:
    keys = {"small_business_support_grant": "sbg", "new_business_startup_grant": "su", "hiring_subsidy": "hire",
            "housing_construction_subsidy": "hs"}
    out = []
    for k, card in sc.policies:
        row = {"key": k, "id": CARD_IDS[k], "enabled": card.enabled, "config": card.model_dump(), **CARD_TEXT[k]}
        if card.enabled and k in keys:
            p = keys[k]
            row["by_year"] = [{"year": y, "active": card.active(y),
                               "recipients": float(np.median(sel[f"{p}_recipients"][:, h])),
                               "paid": float(np.median(sel[f"{p}_paid"][:, h])),
                               "unspent": float(np.median(sel[f"{p}_unspent"][:, h])),
                               "unmet": float(np.median(sel[f"{p}_unmet"][:, h]))} for h, y in enumerate(sc.years)]
            row["total_paid"] = _ser(qs(sel[f"{p}_paid"].sum(1)[:, None]), 0)
        if card.enabled and k == "property_tax_adjustment":
            d = sel["receipts_property_tax"] - base["receipts_property_tax"]
            row["by_year"] = [{"year": y, "active": card.active(y), "rate_cents": float(sel["tax_rate_cents"][0, h]),
                               "levy_change_gross": float(np.median(sel["tax_levy_gross"][:, h] - base["tax_levy_gross"][:, h])),
                               "receipts_change": float(np.median(d[:, h]))} for h, y in enumerate(sc.years)]
        out.append(row)
    return out


def _ledger(base, sel, years) -> list[dict]:
    lines = ["receipts_property_tax", "receipts_sales_tax", "receipts_other", "receipts_total", "expenditure_operating",
             "policy_disbursements", "commitments", "encumbered", "operating_balance", "fund_balance", "funding_gap"]
    return [{"fiscal_year": f"FY{y}", **{ln: {"baseline": float(np.median(base[ln][:, h])), "policy": float(np.median(sel[ln][:, h])),
                                               "delta": float(np.median(sel[ln][:, h] - base[ln][:, h]))} for ln in lines}}
            for h, y in enumerate(years)]


def _cost_effectiveness(base, sel) -> dict:
    """Net fiscal cost per additional job / home over the horizon. Suppressed unless the 95% interval of the
    denominator is strictly positive."""
    cost = (sel["policy_disbursements"] - base["policy_disbursements"]).sum(1) - (sel["receipts_total"] - base["receipts_total"]).sum(1)
    out = {"net_fiscal_cost": _ser(qs(cost[:, None]), 0)}
    for name, metric in (("per_additional_job", "workplace_jobs"), ("per_additional_home", "housing_net_stock_change")):
        den = sel[metric][:, -1] - base[metric][:, -1]
        lo = np.quantile(den, 0.025)
        if lo <= 0:
            out[name] = {"suppressed": True, "reason": "The change in the denominator is zero, negative or its 95% interval crosses zero."}
        else:
            out[name] = {"suppressed": False, **_ser(qs((cost / den)[:, None]), 0)}
    return out


def _result_warnings(sel) -> list[str]:
    w = []
    if np.median(sel["funding_gap"].sum(1)) > 0:
        w.append("Some requested spending could not be funded from legally available sources (no borrowing); see the funding gap.")
    for k, label in (("sbg_unmet", "small-business grant applicants"), ("hs_unmet", "housing units requested beyond capacity or funds")):
        if np.median(sel[k].sum(1)) > 0:
            w.append(f"Unmet demand: {label} were not funded in some years.")
    return w
