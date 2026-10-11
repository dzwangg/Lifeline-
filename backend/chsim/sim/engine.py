"""Paired stock/flow and fiscal transition engine (developer prompt sections 5-7).

Every path is vectorised over draws m = 0..M-1. For each draw the baseline (reference actions) and selected-policy
paths share the initial state, baseline jobs path, macro path, sampled policy parameters and every random number
(counter-keyed streams: seed x year x component). Each path then evaluates its own state-dependent transition.

Mechanism ownership (each quantity is produced in exactly one place):
  baseline        town workplace / resident primary jobs (shared by both paths; never policy-modified)
  sbg module      avoided closures of grant recipients and the jobs they keep
  startup module  incremental openings, relocations, survival, crowd-out closures and their jobs
  hiring module   additional hires after deadweight/substitution, retention and separation
  housing module  funded -> permitted/under construction -> completed or failed pipeline, restrictions and expiry
  ledger          levy arithmetic, receipts, expenditure, payments, encumbrances, fund balance, funding gaps
Policy effects are mechanism responses minus the reference response (zero when actions match), so a scenario without
modifications reproduces the baseline exactly.
"""
from __future__ import annotations
import hashlib
from dataclasses import dataclass, field
import numpy as np
from .scenario import Scenario, FIRST_FY
from .assumptions import PARAMS_FIXED

TOWN_RATE_CENTS = 50.0  # FY2025-26 town rate, cents per $100 (data/assumptions.json); county/school rates excluded
RESIDENT_SHARE = PARAMS_FIXED["resident_share_of_town_jobs"][0]
EXTERNAL_SHARE_2023 = 0.7198701801976362  # NC-only external workplace share of town residents, LODES 2023


def stream(seed: int, year: int, component: str, M: int) -> np.random.Generator:
    """Counter-based stream: the same (seed, year, component) gives identical numbers in both paths."""
    key = int.from_bytes(hashlib.sha256(f"{seed}|{year}|{component}".encode()).digest()[:8], "little")
    return np.random.Generator(np.random.Philox(key=key))


@dataclass
class Anchors:
    """Initial (2026 / FY2026) conditions with their evidence status."""
    taxable_base: float            # parcel snapshot, unaudited (S05+S06)
    restricted_units: float        # FY2025 inventory (S16)
    housing_units: float           # 2020 count, flagged VERIFY in data/baselines.json
    median_gross_rent: float       # ACS 2019-2023 5-year, QuickFacts (data/baselines.json)
    sales_tax: float               # ILLUSTRATIVE placeholder
    other_receipts: float          # ILLUSTRATIVE placeholder
    fund_balance_pct: float        # ILLUSTRATIVE placeholder (share of expenditure)
    housing_lags: list[int]        # observed approval -> completion lags (S13)


@dataclass
class Shared:
    """Inputs common to both paths of a draw."""
    years: list[int]
    jobs: np.ndarray               # [M, H] baseline town workplace primary jobs (persistence + macro)
    rac: np.ndarray                # [M, H] baseline town resident primary jobs
    origin_jobs: np.ndarray        # [M] 2026 nowcast
    origin_rac: np.ndarray
    p: dict[str, np.ndarray]       # sampled parameters, one value per draw
    macro_growth_shift: np.ndarray # [H] added to nominal base growth


@dataclass
class PathState:
    M: int
    base: np.ndarray
    fund_balance: np.ndarray
    tax_reserve: np.ndarray        # designated (earmarked) tax-adjustment revenue not yet spent
    encumbered: np.ndarray         # committed housing payments not yet paid
    sbg_saved: np.ndarray          # recipient establishments still open because of the grant (net of displacement)
    su_alive: np.ndarray           # incremental new establishments still open
    su_reloc_alive: np.ndarray     # incremental relocations into town still open
    su_pending: dict = field(default_factory=dict)   # opening year -> [M] incremental openings awaiting opening
    crowd_out_cum: np.ndarray = None
    hire_active: dict = field(default_factory=dict)  # cohort FY -> [M] additional jobs (subsidised or retained)
    hire_end: dict = field(default_factory=dict)     # cohort FY -> last subsidised FY
    pipeline: list = field(default_factory=list)     # housing cohorts
    restricted_added: list = field(default_factory=list)  # (expiry_year, [M] units)
    enc_pool: dict = field(default_factory=dict)          # funding pool -> [M] encumbered second tranches
    stock_added: np.ndarray = None
    restricted_level: np.ndarray = None


def _zeros(M):
    return np.zeros(M)


def init_state(M: int, a: Anchors) -> PathState:
    receipts0 = a.taxable_base * TOWN_RATE_CENTS / 10_000 * 0.99 + a.sales_tax + a.other_receipts
    s = PathState(M=M, base=np.full(M, a.taxable_base), fund_balance=np.full(M, receipts0 * a.fund_balance_pct / 100),
                  tax_reserve=_zeros(M), encumbered=_zeros(M), sbg_saved=_zeros(M), su_alive=_zeros(M), su_reloc_alive=_zeros(M))
    s.crowd_out_cum, s.stock_added, s.restricted_level = _zeros(M), _zeros(M), np.full(M, a.restricted_units)
    return s


def run_path(sc: Scenario, sh: Shared, a: Anchors, seed: int) -> dict[str, np.ndarray]:
    """Advance one path through the horizon. Returns outcome arrays [M, H] keyed by metric id."""
    M, H, p, P = len(sh.origin_jobs), len(sh.years), sh.p, sc.policies
    s = init_state(M, a)
    exp0 = a.taxable_base * TOWN_RATE_CENTS / 10_000 * 0.99 + a.sales_tax + a.other_receipts  # balanced FY2026 reference
    out: dict[str, np.ndarray] = {}

    def put(k, h, v):
        out.setdefault(k, np.zeros((M, H)))[:, h] = v

    new_assessed_prev = _zeros(M)
    for h, year in enumerate(sh.years):
        fy = year  # FY t (July t-1 .. June t) first affects calendar year t
        infl = (1 + p["cost_inflation"]) ** (h + 1)

        # ---------- taxable base and receipts (ledger) ----------
        tax = P.property_tax_adjustment
        delta_c = tax.change_cents_per_100 if tax.active(fy) else 0.0
        rate = TOWN_RATE_CENTS + delta_c
        growth = p["base_growth_nominal"] + sh.macro_growth_shift[h]
        behavioral = p["tax_base_elasticity"] * (delta_c / TOWN_RATE_CENTS) if tax.include_behavioral_sensitivity else 0.0
        s.base = s.base * (1 + growth) + new_assessed_prev
        base_eff = s.base * (1 + behavioral)
        levy_gross = base_eff * rate / 10_000                       # town levy only; county/school levies excluded
        prop_receipts = levy_gross * p["collection_rate"]
        tax_increment = base_eff * delta_c / 10_000 * p["collection_rate"]
        sales = np.full(M, a.sales_tax) * infl
        other = np.full(M, a.other_receipts) * infl
        receipts = prop_receipts + sales + other
        base_exp = np.full(M, exp0) * infl

        # earmark the tax increment when some card is funded by it
        uses_tax = any(c.active(fy) and c.funding_source == "tax_adjustment" for k, c in P if k != "property_tax_adjustment")
        if uses_tax:
            s.tax_reserve = s.tax_reserve + np.maximum(tax_increment, 0)

        # legally available money for new spending this FY (no borrowing): reserves above the floor, net of encumbrances
        floor = base_exp * sc.reserve_floor_pct / 100
        enc_gf = s.enc_pool.get("general_fund", _zeros(M))
        enc_tax = s.enc_pool.get("tax_adjustment", _zeros(M))
        # One cash limit covers every pool: the earmarked tax increment is already inside receipts and the fund balance,
        # so it is carved out of the general pool rather than added to it, and spending from either pool draws down the
        # same cash. Without this, cards on both pools could spend the earmark twice and dip below the reserve floor.
        cash = np.maximum(s.fund_balance + receipts - base_exp - floor - enc_gf - enc_tax, 0)
        earmark = np.minimum(np.maximum(s.tax_reserve - enc_tax, 0), cash)
        avail = {"general_fund": cash - earmark, "tax_adjustment": earmark, "unfunded": _zeros(M)}
        avail["fund_balance"] = avail["general_fund"]  # same pool; differs in whether it counts as operating spending

        pay_operating, pay_reserves, gap, committed = _zeros(M), _zeros(M), _zeros(M), _zeros(M)

        def allocate(card, request):
            nonlocal cash
            src = card.funding_source
            pool = "general_fund" if src == "fund_balance" else src
            granted = np.minimum(request, avail[pool])
            avail[pool] = avail[pool] - granted
            if pool != "unfunded":  # the shared cash: neither pool may then promise more than is left
                cash = cash - granted
                avail["tax_adjustment"] = np.minimum(avail["tax_adjustment"], cash)
                avail["general_fund"] = np.minimum(avail["general_fund"], cash - avail["tax_adjustment"])
            avail["fund_balance"] = avail["general_fund"]
            return granted, request - granted

        def spend(card, amount):
            nonlocal pay_operating, pay_reserves
            if card.funding_source == "fund_balance":
                pay_reserves = pay_reserves + amount
            else:
                pay_operating = pay_operating + amount
            if card.funding_source == "tax_adjustment":
                s.tax_reserve = s.tax_reserve - amount

        # ---------- housing: payments on earlier commitments come first (obligations) ----------
        hc = P.housing_construction_subsidy
        hs_paid = _zeros(M)
        completed_new, completed_funded, preserved_now, failed_now = _zeros(M), _zeros(M), _zeros(M), _zeros(M)
        new_restricted, newly_restricted_preserved = _zeros(M), _zeros(M)
        for c in s.pipeline:
            due = c["second_tranche"] * (c["complete_year"] == year)
            fail = c["fail"] & (c["complete_year"] == year)
            pay = np.where(fail, 0.0, due)
            released = due  # encumbrance released whether paid or cancelled
            s.encumbered = s.encumbered - released
            s.enc_pool[c["pool"]] = s.enc_pool[c["pool"]] - released
            spend(hc, pay)
            hs_paid += pay
            done = (c["complete_year"] == year) & ~c["fail"]
            completed_funded += np.where(done, c["new_units"], 0)
            completed_new += np.where(done, c["additional_units"], 0)
            failed_now += np.where(fail, c["new_units"] + c["preserved_units"], 0)
            preserved_now += np.where(done, c["preserved_units"], 0)
            if done.any():
                nr = np.where(done, c["new_units"] * c["affordable_share"], 0)  # restriction applies to all funded new units
                pr = np.where(done, c["preserved_units"], 0)                   # preserved units become restricted, not new
                new_restricted += nr
                newly_restricted_preserved += pr
                s.restricted_added.append((year + c["term"], nr + pr))
        hs_request = np.full(M, hc.annual_budget) if hc.active(fy) else _zeros(M)
        hs_unmet = _zeros(M)
        if hs_request.any():
            cap_units = sh.p["hs_capacity_units"]
            units_req = hs_request / hc.award_per_unit
            units = np.minimum(units_req, cap_units)  # capacity cap, not a budget cap
            dollars = units * hc.award_per_unit
            granted, short = allocate(hc, dollars)
            gap += short
            hs_unmet = (units_req - units) + short / hc.award_per_unit
            units = granted / hc.award_per_unit
            committed += granted
            first = granted * 0.5
            spend(hc, first)
            hs_paid += first
            s.encumbered = s.encumbered + (granted - first)
            pool = "general_fund" if hc.funding_source == "fund_balance" else hc.funding_source
            s.enc_pool[pool] = s.enc_pool.get(pool, _zeros(M)) + (granted - first)
            preserved = units * hc.preservation_share
            new_units = units - preserved
            rng = stream(seed, year, "hs_lag", M)
            lag = np.maximum(1, np.array(a.housing_lags)[rng.integers(0, len(a.housing_lags), M)])  # never same-year homes
            fail = stream(seed, year, "hs_fail", M).random(M) < p["hs_failure"]
            s.pipeline.append({"new_units": new_units, "preserved_units": preserved, "additional_units": new_units * p["hs_additionality"],
                               "complete_year": year + lag, "fail": fail, "second_tranche": granted - first, "pool": pool,
                               "affordable_share": hc.affordable_share, "term": hc.affordability_term_years})
        expired_now = sum((u for y, u in s.restricted_added if y == year), _zeros(M))
        s.stock_added = s.stock_added + completed_new  # removals: no demolition data, no policy-induced removals modelled
        s.restricted_level = s.restricted_level + new_restricted + newly_restricted_preserved - expired_now
        new_assessed_prev = completed_new * p["hs_assessed_value_per_unit"]  # enters the base next year
        under_construction = sum((np.where((c["complete_year"] > year) & ~c["fail"], c["new_units"] + c["preserved_units"], 0)
                                  for c in s.pipeline), _zeros(M))

        # ---------- small-business support grant ----------
        sb = P.small_business_support_grant
        elig_scale = {"all_small": 1.0, "retail_food_service": 0.45, "downtown_only": 0.15}[sb.eligibility]
        eligible = p["sbg_eligible_establishments"] * elig_scale
        z = stream(seed, year, "sbg_takeup", M).standard_normal(M)
        applicants = np.clip(eligible * p["sbg_takeup"] + np.sqrt(eligible * p["sbg_takeup"] * (1 - p["sbg_takeup"])) * z, 0, eligible)
        sbg_recipients, sbg_paid, sbg_unmet, sbg_unspent = _zeros(M), _zeros(M), _zeros(M), _zeros(M)
        if sb.active(fy):
            fundable = np.floor(sb.annual_budget / sb.grant_per_establishment)
            want = np.minimum(np.floor(applicants), fundable)
            granted, short = allocate(sb, want * sb.grant_per_establishment)
            gap += short
            sbg_recipients = np.floor(granted / sb.grant_per_establishment)
            sbg_paid = sbg_recipients * sb.grant_per_establishment
            spend(sb, sbg_paid)
            sbg_unmet = np.floor(applicants) - sbg_recipients
            sbg_unspent = sb.annual_budget - sbg_paid
        h0 = p["sbg_base_closure_hazard"]
        rho = p["sbg_hazard_reduction_max"] * (1 - np.exp(-sb.grant_per_establishment / p["sbg_dose_half"]))
        avoided = sbg_recipients * h0 * rho * (1 - p["sbg_displacement"])
        s.sbg_saved = s.sbg_saved * (1 - h0) + avoided  # saved establishments then face the ordinary hazard

        # ---------- startup grant ----------
        su = P.new_business_startup_grant
        su_awards, su_paid, su_unspent = _zeros(M), _zeros(M), _zeros(M)
        opens_new, opens_reloc = s.su_pending.pop(year, (_zeros(M), _zeros(M)))
        if su.active(fy):
            elig = p["su_applications"] * p["su_eligible_share"] * (0.5 if su.eligibility == "storefront_only" else 1.0)
            want = np.minimum(np.floor(elig), np.floor(su.annual_budget / su.award_per_startup))
            granted, short = allocate(su, want * su.award_per_startup)
            gap += short
            su_awards = np.floor(granted / su.award_per_startup)
            su_paid = su_awards * su.award_per_startup
            spend(su, su_paid)
            su_unspent = su.annual_budget - su_paid
            incr = su_awards * p["su_additionality"]
            nxt = s.su_pending.get(year + 1, (_zeros(M), _zeros(M)))  # one-year startup delay
            s.su_pending[year + 1] = (nxt[0] + incr * (1 - p["su_relocation_share"]), nxt[1] + incr * p["su_relocation_share"])
        su_fail = s.su_alive * p["su_later_hazard"]
        s.su_alive = s.su_alive - su_fail + opens_new * p["su_first_year_survival"]
        s.su_reloc_alive = s.su_reloc_alive * (1 - p["su_later_hazard"]) + opens_reloc * p["su_first_year_survival"]
        first_year_fail = (opens_new + opens_reloc) * (1 - p["su_first_year_survival"])
        crowd = (opens_new + opens_reloc) * p["su_crowd_out"]
        s.crowd_out_cum = s.crowd_out_cum * (1 - h0) + crowd

        # ---------- hiring subsidy ----------
        hi = P.hiring_subsidy
        hire_paid, hire_qualifying, hire_unspent = _zeros(M), _zeros(M), _zeros(M)
        base_jobs = sh.jobs[:, h]
        for cy in list(s.hire_active):
            if year > s.hire_end[cy]:
                first_after = year == s.hire_end[cy] + 1
                s.hire_active[cy] = s.hire_active[cy] * (p["hire_retention_after"] if first_after else 1 - p["hire_separation_later"])
        if hi.active(fy):
            pool = base_jobs * p["hire_rate"] * p["hire_eligible_share"] * (RESIDENT_SHARE if hi.eligibility == "town_residents_only" else 1.0)
            cost = hi.subsidy_per_hire  # paid per qualifying hire within the FY (duration > 12 months is paid in one FY here)
            want = np.minimum(np.floor(pool), np.floor(hi.annual_budget / cost))
            granted, short = allocate(hi, want * cost)
            gap += short
            hire_qualifying = np.floor(granted / cost)
            hire_paid = hire_qualifying * cost
            spend(hi, hire_paid)
            hire_unspent = hi.annual_budget - hire_paid
            additional = hire_qualifying * (1 - p["hire_deadweight"]) * (1 - p["hire_substitution"])
            additional = np.minimum(additional, base_jobs * p["labor_slack_cap"])  # labour availability
            s.hire_active[year] = additional
            s.hire_end[year] = year + (hi.duration_months - 1) // 12
        hire_jobs = sum(s.hire_active.values(), _zeros(M))
        hire_resident_share = 1.0 if hi.eligibility == "town_residents_only" else RESIDENT_SHARE

        # ---------- outcomes ----------
        sbg_jobs = s.sbg_saved * p["jobs_per_small_establishment"]
        su_jobs = (s.su_alive + s.su_reloc_alive - s.crowd_out_cum) * p["jobs_per_new_establishment"]
        policy_jobs = sbg_jobs + su_jobs + hire_jobs
        resident_add = (sbg_jobs + su_jobs) * RESIDENT_SHARE + hire_jobs * hire_resident_share
        put("workplace_jobs", h, base_jobs + policy_jobs)
        put("resident_jobs", h, sh.rac[:, h] + resident_add)
        in_town = sh.rac[:, h] * (1 - EXTERNAL_SHARE_2023) + resident_add
        put("external_workplace_share", h, 100 * (1 - in_town / (sh.rac[:, h] + resident_add)))
        put("establishments_change", h, s.sbg_saved + s.su_alive + s.su_reloc_alive - s.crowd_out_cum)
        put("openings_new", h, opens_new)
        put("openings_relocations", h, opens_reloc)
        put("closures_change", h, -avoided + su_fail + first_year_fail + crowd)
        put("housing_completed_new", h, completed_new)
        put("housing_completed_funded", h, completed_funded)
        put("housing_removals", h, _zeros(M))
        put("housing_net_stock_change", h, s.stock_added)
        put("housing_under_construction", h, under_construction)
        put("housing_failed", h, failed_now)
        put("restricted_new_completed", h, new_restricted)
        put("restricted_preserved", h, newly_restricted_preserved)
        put("restricted_expired", h, expired_now)
        put("restricted_stock", h, s.restricted_level)
        put("median_gross_rent", h, a.median_gross_rent * (1 + p["rent_supply_elasticity"] * s.stock_added / a.housing_units))
        put("taxable_base", h, base_eff)

        exp_operating = base_exp + pay_operating
        op_balance = receipts - exp_operating
        s.fund_balance = s.fund_balance + op_balance - pay_reserves
        put("receipts_property_tax", h, prop_receipts)
        put("receipts_sales_tax", h, sales)
        put("receipts_other", h, other)
        put("receipts_total", h, receipts)
        put("expenditure_operating", h, exp_operating)
        put("policy_disbursements", h, pay_operating + pay_reserves)
        put("operating_balance", h, op_balance)
        put("fund_balance", h, s.fund_balance)
        put("fund_balance_pct", h, 100 * s.fund_balance / exp_operating)
        put("funding_gap", h, gap)
        put("commitments", h, committed + sbg_paid + su_paid + hire_paid)
        put("encumbered", h, s.encumbered)
        put("tax_levy_gross", h, levy_gross)
        put("tax_rate_cents", h, np.full(M, rate))
        for k, v in {"sbg": (sbg_recipients, sbg_paid, sbg_unspent, sbg_unmet), "su": (su_awards, su_paid, su_unspent, _zeros(M)),
                     "hire": (hire_qualifying, hire_paid, hire_unspent, _zeros(M)),
                     "hs": (completed_funded, hs_paid, (hs_request - committed) if hs_request.any() else _zeros(M), hs_unmet)}.items():
            put(f"{k}_recipients", h, v[0])
            put(f"{k}_paid", h, v[1])
            put(f"{k}_unspent", h, v[2])
            put(f"{k}_unmet", h, v[3])
        _validate(out, h, s)
    return out


def _validate(out: dict, h: int, s: PathState) -> None:
    """Physical and accounting invariants; a violation is a bug, so it raises."""
    for k in ("housing_completed_new", "housing_completed_funded", "restricted_stock", "taxable_base", "sbg_recipients",
              "su_recipients", "hire_recipients", "funding_gap", "encumbered"):
        if (out[k][:, h] < -1e-6).any():
            raise AssertionError(f"negative {k} in period {h}")
    if (out["housing_completed_new"][:, h] > out["housing_completed_funded"][:, h] + 1e-6).any():
        raise AssertionError("additional completions exceed funded completions")
    for k in ("sbg", "su", "hire"):
        if (out[f"{k}_unspent"][:, h] < -1e-6).any():
            raise AssertionError(f"{k} disbursed more than its budget")
    if (s.su_alive < -1e-9).any() or (s.sbg_saved < -1e-9).any():
        raise AssertionError("negative establishment stock")
