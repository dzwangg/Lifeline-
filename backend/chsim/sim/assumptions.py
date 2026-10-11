"""Response and accounting parameters with disclosed ranges and evidence grades (developer prompt section 5).

Evidence grades (dossier section 12): observed_arithmetic | identified_local | transported_external | assumption_only.
No parameter here is an identified local causal effect: the records needed for that (applicants, awards, comparison
outcomes) were not available. Ranges are sensitivity assumptions; each draw samples one value and holds it across the
paired baseline/policy trajectory. Distributions are PERT-style Betas on [low, high] with mode `central` (seeded NumPy).
"""
from __future__ import annotations
import hashlib
from dataclasses import dataclass
import numpy as np


@dataclass(frozen=True)
class A:
    low: float
    central: float
    high: float
    unit: str
    grade: str
    note: str

    def sample(self, n: int, rng: np.random.Generator) -> np.ndarray:
        if self.high == self.low:
            return np.full(n, self.central)
        span = self.high - self.low
        m = (self.central - self.low) / span
        a, b = 1 + 4 * m, 1 + 4 * (1 - m)
        return self.low + span * rng.beta(a, b, n)


ASSUME = "assumption_only"
EXT = "transported_external"
OBS = "observed_arithmetic"

PARAMS: dict[str, A] = {
    # ---- small-business support grant ----
    "sbg_eligible_establishments": A(1200, 1800, 2500, "establishments", ASSUME,
        "Townwide small establishments eligible for support. No establishment registry was acquired (dossier S33-S36)."),
    "sbg_takeup": A(0.15, 0.30, 0.50, "share of eligible", ASSUME, "Share of eligible establishments that apply in a funded year."),
    "sbg_base_closure_hazard": A(0.06, 0.09, 0.12, "per year", EXT,
        "Annual establishment exit rate, in the range of national Business Dynamics Statistics rates (S34, not acquired locally)."),
    "sbg_hazard_reduction_max": A(0.0, 0.10, 0.25, "relative", ASSUME,
        "Largest relative cut in a recipient's closure hazard; scaled by grant size with diminishing returns. Can be zero."),
    "sbg_dose_half": A(8000, 15000, 30000, "$", ASSUME, "Grant size giving half of the maximum hazard reduction."),
    "sbg_displacement": A(0.0, 0.20, 0.40, "share", ASSUME, "Share of avoided closures offset by competitors' closures."),
    "jobs_per_small_establishment": A(4, 6, 9, "jobs", ASSUME, "Primary jobs per small local establishment."),
    # ---- startup grant ----
    "su_applications": A(60, 120, 200, "per year", ASSUME,
        "Startup applications per funded year. County Business Formation Statistics (S35) were not acquired."),
    "su_eligible_share": A(0.4, 0.6, 0.8, "share", ASSUME, "Share of applications meeting eligibility."),
    "su_additionality": A(0.10, 0.25, 0.50, "share", ASSUME, "Share of awardees that would not otherwise open in town."),
    "su_relocation_share": A(0.05, 0.20, 0.35, "share", ASSUME, "Share of incremental openings that are relocations, not new establishments."),
    "su_first_year_survival": A(0.70, 0.80, 0.90, "share", EXT, "Survival through the first year of operation (BDS-like range)."),
    "su_later_hazard": A(0.08, 0.12, 0.18, "per year", EXT, "Annual exit hazard after the first year."),
    "su_crowd_out": A(0.0, 0.15, 0.30, "share", ASSUME, "Competitor closures per incremental opening."),
    "jobs_per_new_establishment": A(2, 3, 5, "jobs", ASSUME, "Primary jobs per new establishment."),
    # ---- hiring subsidy ----
    "hire_rate": A(0.20, 0.30, 0.40, "hires per job per year", ASSUME,
        "Gross hires per workplace job. QWI hire rates (S31) were not acquired."),
    "hire_eligible_share": A(0.10, 0.20, 0.35, "share of hires", ASSUME, "Share of baseline hires at eligible employers/positions."),
    "hire_deadweight": A(0.40, 0.60, 0.85, "share", ASSUME, "Subsidised hires that would have happened anyway."),
    "hire_substitution": A(0.0, 0.15, 0.30, "share", ASSUME, "Additional hires offset by fewer unsubsidised hires."),
    "hire_retention_after": A(0.40, 0.60, 0.80, "share", ASSUME, "Additional jobs still filled one year after support ends."),
    "hire_separation_later": A(0.15, 0.25, 0.35, "per year", ASSUME, "Annual separation of retained additional jobs."),
    "labor_slack_cap": A(0.005, 0.01, 0.02, "share of jobs", ASSUME, "Cap on additional hires per year from labour availability."),
    # ---- housing construction subsidy ----
    "hs_capacity_units": A(80, 150, 250, "units per year", ASSUME,
        "Feasible subsidisable units per year. Zoning, sewer capacity (OWASA), flood and soil layers were not acquired."),
    "hs_additionality": A(0.25, 0.50, 0.75, "share", ASSUME,
        "Share of funded new units that would not be built without the subsidy (financing-gap additionality)."),
    "hs_failure": A(0.05, 0.10, 0.20, "share", ASSUME, "Funded projects cancelled before completion."),
    "hs_assessed_value_per_unit": A(200000, 300000, 400000, "$", ASSUME, "Assessed value added per completed new unit."),
    "rent_supply_elasticity": A(-0.19, -0.10, 0.0, "elasticity", EXT,
        "Rent change per % change in housing stock: Li (2022) -0.1; Mense (2025) -0.19 (as cited in data/assumptions.json). "
        "Transported from other markets; not a Chapel Hill estimate."),
    # ---- property tax and fiscal ----
    "collection_rate": A(0.985, 0.99, 0.995, "share", ASSUME, "Current-year collection rate. Audited collection history (S42) was blocked."),
    "tax_base_elasticity": A(0.0, 0.0, 0.0, "elasticity", ASSUME,
        "Behavioural response of the taxable base to the town rate. Fixed at 0: not identified; lower taxes are not assumed to cause growth."),
    "base_growth_nominal": A(0.01, 0.025, 0.04, "per year", ASSUME,
        "Nominal growth of the town-taxable base between revaluations. No assessment history was acquired."),
    "cost_inflation": A(0.02, 0.03, 0.04, "per year", ASSUME, "Nominal growth of comparable operating expenditure."),
}

PARAMS_FIXED = {
    # Observed or arithmetic anchors (not sampled).
    "resident_share_of_town_jobs": (5783 / 50889, OBS,
        "Residents working in town / town workplace primary jobs, LODES 2023 (S24)."),
}


def sample_all(n: int, seed: int, overrides: dict[str, float] | None = None) -> dict[str, np.ndarray]:
    """One value per draw for every parameter. `overrides` pins a parameter (used for optimistic/adverse cases)."""
    out = {}
    for k in sorted(PARAMS):  # one stream per parameter -> adding a parameter never shifts the others' draws
        out[k] = PARAMS[k].sample(n, np.random.default_rng([seed, int(hashlib.sha256(k.encode()).hexdigest()[:12], 16)]))
    for k, v in (overrides or {}).items():
        out[k] = np.full(n, float(v))
    return out


def describe() -> list[dict]:
    return [{"key": k, "low": a.low, "central": a.central, "high": a.high, "unit": a.unit, "grade": a.grade, "note": a.note}
            for k, a in PARAMS.items()] + [
        {"key": k, "low": v, "central": v, "high": v, "unit": "share", "grade": g, "note": n} for k, (v, g, n) in PARAMS_FIXED.items()]
