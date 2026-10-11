"""Metric catalog: the ten outcome families (developer prompt section 8) with units, direction and evidence status.

level      what the baseline level rests on: persistence | observed_anchor | arithmetic | assumption | illustrative | unavailable
effect     what the policy-minus-baseline change rests on (same vocabulary)
favorable  up | down | neutral  (neutral = ambiguous; the UI uses neutral colours)
kind       count | currency | percent | rate   (percent changes are reported in percentage points)
"""
from __future__ import annotations

M = lambda id, family, label, unit, kind, favorable, level, effect, note="", show=True: dict(
    id=id, family=family, label=label, unit=unit, kind=kind, favorable=favorable, level=level, effect=effect, note=note, show=show)

FAMILIES = {
    1: "Primary workplace jobs", 2: "Resident employment", 3: "Operating establishments",
    4: "Openings, closures, relocations", 5: "New housing", 6: "Income-restricted housing",
    7: "Rent and burden", 8: "Town-taxable base", 9: "Town receipts", 10: "Spending, balance and reserves",
}

METRICS = [
    M("workplace_jobs", 1, "Workplace primary jobs", "jobs", "count", "up", "persistence", "assumption",
      "Baseline: last observed LODES JT01 year (2023) carried forward, spread from observed 2009-2023 annual changes; no ML. Change: assumption-based response modules."),
    M("resident_jobs", 2, "Resident primary-job employment", "jobs", "count", "up", "persistence", "assumption",
      "Residents of the 2020 town place holding a primary job anywhere in NC (LODES RAC). Not the ACS employment rate."),
    M("external_workplace_share", 2, "Residents working outside town", "%", "percent", "neutral", "observed_anchor", "assumption",
      "NC-only share (out-of-state destinations need other states' files); held at the 2023 observed share in the baseline."),
    M("establishments_change", 3, "Operating establishments (change)", "establishments", "count", "up", "unavailable", "assumption",
      "No townwide establishment registry, so the stock level is unavailable; only the policy-induced change is shown."),
    M("openings_new", 4, "New establishment openings (change)", "per year", "count", "up", "unavailable", "assumption"),
    M("openings_relocations", 4, "Relocations into town (change)", "per year", "count", "neutral", "unavailable", "assumption",
      "Relocations are not new businesses; they may move activity from elsewhere in the region."),
    M("closures_change", 4, "Establishment closures (change)", "per year", "count", "down", "unavailable", "assumption"),
    M("housing_completed_new", 5, "Completed new homes (additional)", "units per year", "count", "up", "unavailable", "assumption",
      "Only completions caused by the subsidy (after additionality). Baseline construction is unavailable: no completion history."),
    M("housing_removals", 5, "Housing removals", "units per year", "count", "down", "unavailable", "unavailable",
      "No demolition or conversion records were acquired.", show=False),
    M("housing_net_stock_change", 5, "Net housing stock change (cumulative)", "units", "count", "up", "unavailable", "assumption"),
    M("housing_under_construction", 5, "Funded units in the pipeline", "units", "count", "neutral", "unavailable", "assumption"),
    M("restricted_new_completed", 6, "Completed income-restricted new units", "units per year", "count", "up", "unavailable", "assumption"),
    M("restricted_preserved", 6, "Units newly restricted by preservation", "units per year", "count", "up", "unavailable", "assumption",
      "Preservation restricts existing homes; it adds no physical units."),
    M("restricted_expired", 6, "Restrictions expiring", "units per year", "count", "down", "observed_anchor", "arithmetic"),
    M("restricted_stock", 6, "Income-restricted stock", "units", "count", "up", "observed_anchor", "assumption",
      "Starts from 1,138 units in the FY2025 inventory (S16); most units have no recorded end date, so unknown expiries are not modelled."),
    M("median_gross_rent", 7, "Median gross rent", "$ per month", "currency", "down", "observed_anchor", "assumption",
      "Level is the ACS 2019-2023 5-year anchor ($1,483), not an annual forecast. Change: transported supply elasticity."),
    M("renter_burden", 7, "Renters paying 30%+ of income", "%", "percent", "down", "unavailable", "unavailable",
      "Needs ACS B25070 (CENSUS_API_KEY not set). No annual burden model.", show=False),
    M("taxable_base", 8, "Town-taxable assessed base", "$", "currency", "up", "assumption", "assumption",
      "FY2026 anchor from an unaudited parcel snapshot ($12.88B); growth is an assumed range; new homes add assessed value."),
    M("receipts_property_tax", 9, "Property-tax receipts", "$", "currency", "neutral", "arithmetic", "arithmetic",
      "Levy = base x rate (cents) / 10,000 x collection rate. Town levy only."),
    M("receipts_sales_tax", 9, "Sales-tax distribution", "$", "currency", "neutral", "illustrative", "unavailable",
      "ILLUSTRATIVE placeholder: NCDOR distribution history (S45) not acquired. Policies do not change it here."),
    M("receipts_other", 9, "Other comparable receipts", "$", "currency", "neutral", "illustrative", "unavailable",
      "ILLUSTRATIVE placeholder: audited receipts (S42) blocked."),
    M("receipts_total", 9, "Total comparable receipts", "$", "currency", "neutral", "illustrative", "arithmetic"),
    M("expenditure_operating", 10, "Comparable operating expenditure", "$", "currency", "neutral", "illustrative", "arithmetic",
      "ILLUSTRATIVE baseline (balanced FY2026 reference grown by assumed cost inflation) plus exact policy payments."),
    M("policy_disbursements", 10, "Policy disbursements", "$", "currency", "neutral", "arithmetic", "arithmetic"),
    M("operating_balance", 10, "Operating balance", "$", "currency", "up", "illustrative", "arithmetic"),
    M("fund_balance", 10, "Available fund balance", "$", "currency", "up", "illustrative", "arithmetic"),
    M("fund_balance_pct", 10, "Fund balance, % of expenditure", "%", "percent", "up", "illustrative", "arithmetic"),
    M("funding_gap", 10, "Funding gap (unfunded requests)", "$", "currency", "down", "arithmetic", "arithmetic",
      "Requested spending that no legally available source could cover (no borrowing)."),
]
BY_ID = {m["id"]: m for m in METRICS}
