"""Healthy-city benchmark (developer prompt section 2C). A goal, not a causal counterfactual.

Peer-city selection must be frozen before comparison; no peer panel was assembled, so every target below is a
user-editable "Illustrative target". Targets are applied after simulation and never alter a transition.
"""
from __future__ import annotations
import numpy as np
from .scenario import Targets

PEER_SELECTION = {"status": "not assembled", "frozen": False, "peers": [],
                  "criteria": ["population", "university presence", "economy", "housing", "fiscal responsibilities"]}


def target_paths(t: Targets, years: list[int], origin: dict[str, float], housing_units: float) -> dict[str, dict]:
    """metric id -> {kind: threshold_min|threshold_max, values: [H], label, source}."""
    h = np.arange(1, len(years) + 1)
    lab = "Illustrative target"
    return {
        "workplace_jobs": {"kind": "threshold_min", "values": origin["workplace_jobs"] * (1 + t.workplace_jobs_growth_pct_per_year / 100) ** h,
                           "label": f"{lab}: +{t.workplace_jobs_growth_pct_per_year}%/yr from the 2026 nowcast median"},
        "resident_jobs": {"kind": "threshold_min", "values": origin["resident_jobs"] * (1 + t.resident_jobs_growth_pct_per_year / 100) ** h,
                          "label": f"{lab}: +{t.resident_jobs_growth_pct_per_year}%/yr from the 2026 nowcast median"},
        "restricted_stock": {"kind": "threshold_min", "values": np.full(len(h), housing_units * t.restricted_share_of_stock_pct / 100),
                             "label": f"{lab}: {t.restricted_share_of_stock_pct}% of the housing stock anchor"},
        "operating_balance": {"kind": "threshold_min", "values": np.full(len(h), t.operating_balance_min),
                              "label": f"{lab}: operating balance of at least ${t.operating_balance_min:,.0f}"},
        "fund_balance_pct": {"kind": "threshold_min", "values": np.full(len(h), t.fund_balance_pct_of_expenditure),
                             "label": f"{lab}: fund balance of at least {t.fund_balance_pct_of_expenditure}% of expenditure "
                                      "(8% is the commonly cited NC Local Government Commission minimum; verify)"},
        "renter_burden": {"kind": "threshold_max", "values": np.full(len(h), t.renter_burden_max_pct),
                          "label": f"{lab}: at most {t.renter_burden_max_pct}% of renters cost-burdened (metric unavailable)"},
    }
