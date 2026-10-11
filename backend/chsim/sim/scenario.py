"""Versioned scenario and policy-card schemas (developer prompt sections 5 and 10).

Fiscal years are named by their ending June: FY2027 = July 2026 - June 2027. Economic outcomes are calendar years.
Mapping used by the engine (disclosed): spending in FY t first affects calendar year t.
"""
from __future__ import annotations
import hashlib, json
from typing import Literal
from pydantic import BaseModel, Field, model_validator

POLICY_SCHEMA_VERSION = "policy-cards.v1"
FIRST_FY, ORIGIN_YEAR = 2027, 2026
FundingSource = Literal["general_fund", "fund_balance", "tax_adjustment", "unfunded"]


class Card(BaseModel):
    enabled: bool = False
    start_fy: int = Field(FIRST_FY, ge=FIRST_FY, le=FIRST_FY + 9)
    end_fy: int = Field(FIRST_FY + 2, ge=FIRST_FY, le=FIRST_FY + 9)
    funding_source: FundingSource = "general_fund"

    @model_validator(mode="after")
    def _order(self):
        if self.end_fy < self.start_fy:
            raise ValueError("end_fy must be on or after start_fy")
        return self

    def active(self, fy: int) -> bool:
        return self.enabled and self.start_fy <= fy <= self.end_fy


class SmallBusinessGrant(Card):
    annual_budget: float = Field(500_000, ge=0, le=10_000_000)
    grant_per_establishment: float = Field(10_000, ge=1_000, le=100_000)
    eligibility: Literal["all_small", "retail_food_service", "downtown_only"] = "all_small"


class StartupGrant(Card):
    annual_budget: float = Field(300_000, ge=0, le=5_000_000)
    award_per_startup: float = Field(15_000, ge=1_000, le=100_000)
    eligibility: Literal["all_new", "storefront_only"] = "all_new"


class HiringSubsidy(Card):
    annual_budget: float = Field(400_000, ge=0, le=10_000_000)
    subsidy_per_hire: float = Field(5_000, ge=500, le=30_000)
    duration_months: int = Field(12, ge=1, le=24)
    eligibility: Literal["any_hire", "town_residents_only"] = "any_hire"


class HousingSubsidy(Card):
    annual_budget: float = Field(2_000_000, ge=0, le=50_000_000)
    award_per_unit: float = Field(40_000, ge=5_000, le=300_000)
    affordable_share: float = Field(0.5, ge=0, le=1)
    affordability_term_years: int = Field(30, ge=1, le=99)
    preservation_share: float = Field(0.0, ge=0, le=1)
    area: Literal["townwide", "transit_corridors"] = "townwide"


class PropertyTax(Card):
    change_cents_per_100: float = Field(0.0, ge=-15, le=15)
    duration_years: int = Field(0, ge=0, le=10)  # 0 = through the end of the horizon
    applies_to: Literal["all_town_taxable_real_property"] = "all_town_taxable_real_property"
    include_behavioral_sensitivity: bool = False

    def active(self, fy: int) -> bool:
        last = self.end_fy_effective
        return self.enabled and self.start_fy <= fy <= last

    @property
    def end_fy_effective(self) -> int:
        return FIRST_FY + 99 if self.duration_years == 0 else self.start_fy + self.duration_years - 1


class Policies(BaseModel):
    small_business_support_grant: SmallBusinessGrant = SmallBusinessGrant()
    new_business_startup_grant: StartupGrant = StartupGrant()
    hiring_subsidy: HiringSubsidy = HiringSubsidy()
    housing_construction_subsidy: HousingSubsidy = HousingSubsidy()
    property_tax_adjustment: PropertyTax = PropertyTax()


CARD_IDS = {  # API key -> id used by the existing policy panel (meridian-city/policy/policies.js)
    "small_business_support_grant": "small-business-support-grant",
    "new_business_startup_grant": "new-business-startup-grant",
    "hiring_subsidy": "hiring-subsidy",
    "housing_construction_subsidy": "housing-construction-subsidy",
    "property_tax_adjustment": "property-tax-adjustment",
}
NO_SPENDING = {"property_tax_adjustment"}

class Targets(BaseModel):
    """Illustrative healthy-city targets (user-editable). They never enter the simulation."""
    workplace_jobs_growth_pct_per_year: float = 1.0
    resident_jobs_growth_pct_per_year: float = 0.5
    restricted_share_of_stock_pct: float = 10.0
    operating_balance_min: float = 0.0
    fund_balance_pct_of_expenditure: float = 8.0
    renter_burden_max_pct: float = 40.0


class Scenario(BaseModel):
    schema_version: Literal["policy-cards.v1"] = POLICY_SCHEMA_VERSION
    name: str = "Untitled scenario"
    horizon_years: Literal[5, 10] = 5
    macro: Literal["central", "adverse", "optimistic"] = "central"
    draws: int = Field(500, ge=50, le=2000)
    seed: int = Field(20261010, ge=0)
    policies: Policies = Policies()
    targets: Targets = Targets()
    reserve_floor_pct: float = Field(8.0, ge=0, le=50)  # no-borrowing: fund balance may not fall below this share

    def sim_hash(self) -> str:
        """Hash of everything that changes the simulated numbers. Targets and name are excluded on purpose."""
        d = self.model_dump(exclude={"targets", "name"})
        return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()

    def full_hash(self) -> str:
        return hashlib.sha256(json.dumps(self.model_dump(), sort_keys=True).encode()).hexdigest()

    @property
    def years(self) -> list[int]:
        return list(range(ORIGIN_YEAR + 1, ORIGIN_YEAR + 1 + self.horizon_years))

    def reference(self) -> "Scenario":
        """Current-policy baseline: same draws, macro path and seed; no new programmes, adopted tax rate."""
        return self.model_copy(update={"policies": Policies()})

    def validation_warnings(self) -> list[str]:
        w, p = [], self.policies
        uses_tax = [k for k, c in p if c.enabled and c.funding_source == "tax_adjustment" and k not in NO_SPENDING]
        if uses_tax and not (p.property_tax_adjustment.enabled and p.property_tax_adjustment.change_cents_per_100 > 0):
            w.append(f"{', '.join(uses_tax)} funded by a tax adjustment, but no positive property-tax change is enabled: "
                     "spending will be capped and the financing gap shown.")
        for k, c in p:
            if k in NO_SPENDING:
                continue
            if c.enabled and c.funding_source == "unfunded":
                w.append(f"{k} is unfunded: disbursements are capped at legally available funds and the gap is shown.")
            if c.enabled and c.start_fy > self.years[-1]:
                w.append(f"{k} starts in FY{c.start_fy}, after the {self.horizon_years}-year horizon.")
        return w
