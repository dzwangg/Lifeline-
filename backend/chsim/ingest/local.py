"""Town and county administrative layers -> processed evidence tables with explicit quality flags.

Nothing here drives an outcome series unless its flag says so. Quality problems found in the raw
layers are recorded (not silently repaired) in data/processed/quality_findings.json.
"""
from __future__ import annotations
import json, re
import pandas as pd
from ..config import RAW, PROCESSED
from .arcgis import load_rows


def _fy(v) -> int | None:
    """'FY19', 'Fy13', 'FY 28' -> 2019 (fiscal year ending June 30)."""
    m = re.search(r"(\d{2})\b", str(v or ""))
    return 2000 + int(m.group(1)) if m and str(v).strip().upper().startswith("FY") else None


def housing_grants() -> dict:
    g = pd.DataFrame(load_rows(RAW / "S13" / "features.json"))
    g["project_type"] = g["ProjectType"].fillna("").str.strip()
    g["fy_approved"] = g["FiscalYearApproved"].map(_fy)
    g["fy_completed"] = g["YearCompleted"].map(_fy)
    g["lag_years"] = g["fy_completed"] - g["fy_approved"]
    keep = ["OBJECTID", "fy_approved", "fy_completed", "lag_years", "Provider", "Project_or_Development", "project_type",
            "RentalVsOwnership", "DevelopmentUnitsApproved", "DevelopmentUnitsCompleted", "PreservationUnitsApproved",
            "PreservationUnitsCompleted", "Total", "TotalFundingDisbursed", "ProjectStatus", "PIN"]
    g[keep].to_csv(PROCESSED / "housing_grants_S13.csv", index=False)
    dev = g[(g.project_type == "Development") & g.lag_years.notna() & (g.lag_years >= 0)]
    by_fy = g.groupby("fy_approved").agg(rows=("OBJECTID", "size"), approved_dollars=("Total", "sum")).reset_index()
    return {
        "rows": int(len(g)),
        "approved_dollars_total": float(g["Total"].sum()),
        "disbursed_dollars_total": float(g["TotalFundingDisbursed"].sum()),
        "approved_by_fiscal_year": by_fy.to_dict("records"),
        "development_completion_lag_years": sorted(dev.lag_years.astype(int).tolist()),
        "rows_with_completion_year": int(g.fy_completed.notna().sum()),
        "quality": [
            "Unit fields disagree (e.g. *Approved vs *ToDate vs *Completed2); row grain and cumulative semantics unverified.",
            "TotalFundingDisbursed sums to far less than Total approved; disbursement coverage is incomplete, not zero spending.",
            f"{int(g.fy_completed.isna().sum())} of {len(g)} rows lack a completion year (unknown, not incomplete).",
        ],
    }


def restricted_inventory() -> dict:
    s = pd.DataFrame(load_rows(RAW / "S16" / "features.json"))
    ch = s[s["Jurisdiction"].fillna("").str.strip() == "Chapel Hill"].copy()
    end = pd.to_datetime(ch["Affordability_End_Date"], unit="ms", errors="coerce")
    return {
        "as_of": "FY2025 inventory (S16)",
        "restricted_units_chapel_hill": int(len(ch)),
        "by_type": ch["ProjectType"].value_counts().to_dict(),
        "by_tenure": ch["RentalOwnership"].value_counts().to_dict(),
        "expiry_year_counts": {int(k): int(v) for k, v in end.dt.year.value_counts().sort_index().items()},
        "expiry_unknown_units": int(end.isna().sum()),
        "quality": ["One row per unit is assumed from the schema (PIN/address/bedrooms); verify before using as a stock count.",
                    "Most units have no Affordability_End_Date; unknown expiry is not 'never expires'."],
    }


def taxable_base() -> dict:
    o = pd.DataFrame(load_rows(RAW / "S05" / "features.json"))
    o.columns = [c.split(".")[-1] for c in o.columns]
    rows = len(o)
    o = o.drop_duplicates("PIN")  # the view joins building records: one parcel can repeat
    o["exempt"] = o["LandUseCode"].fillna("").str.strip().str.startswith("EX")
    town = o[o["RATECODE1"] == "22"]
    d = pd.DataFrame(load_rows(RAW / "S06" / "features.json"))
    d_share = pd.to_numeric(d["CITY_PCNT"], errors="coerce").fillna(100) / 100
    d_taxable = float(((d["TOTAL_PROP_VALUE"].fillna(0) - d["OTHER_EXMPT"].fillna(0) - d["TOTAL_DEFERRED_VALUE"].fillna(0)) * d_share).sum())
    orange_taxable = float(town.loc[~town.exempt, "VALUATION"].sum())
    return {
        "status": "unaudited current parcel snapshot; not an assessment history",
        "orange_side_taxable": orange_taxable,
        "orange_side_exempt_value": float(town.loc[town.exempt, "VALUATION"].sum()),
        "orange_parcels": int(len(town)),
        "durham_side_taxable": d_taxable,
        "durham_parcels": int(len(d)),
        "durham_snapshot_dates": sorted({str(x.date()) for x in pd.to_datetime(d["AUT_SNAPSHOT_DATE"], unit="ms").dropna()})[:5],
        "town_taxable_assessed_value": orange_taxable + d_taxable,
        "quality": [
            f"Orange view repeats parcels through a building join: {rows} rows, {len(o)} unique PINs; deduplicated by PIN.",
            "Orange rate code '22' is INFERRED to be the Chapel Hill town district (largest district; contains the UNC campus PIN). "
            "Verify against Orange County's rate-code table (S46).",
            "Orange exemptions approximated by land-use codes starting 'EX'; elderly/veteran exclusions and deferrals are not in this view.",
            "Values may mix pre- and post-2025 revaluation vintages; personal property and vehicles are excluded.",
        ],
    }


def downtown_events() -> dict:
    t = pd.DataFrame(load_rows(RAW / "S36" / "features.json"))
    opened = pd.to_datetime(t["Date_Opened"], errors="coerce", format="mixed").dt.year
    closed = pd.to_datetime(t["Date_Closed"], errors="coerce", format="mixed").dt.year
    return {
        "rows": int(len(t)),
        "openings_by_year": {int(k): int(v) for k, v in opened.value_counts().sort_index().items()},
        "closures_by_year": {int(k): int(v) for k, v in closed.value_counts().sort_index().items()},
        "quality": ["Downtown only; last edit June 30, 2020; survivorship and censoring bias. Not a townwide registry and "
                    "not used as an outcome series."],
    }


def build() -> dict:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    out = {"housing_grants": housing_grants(), "restricted_inventory": restricted_inventory(),
           "taxable_base": taxable_base(), "downtown_events": downtown_events()}
    out["budget_actuals_S44"] = {
        "usable": False,
        "quality": ["Values are shifted one column right (Category holds Original_Budget, Original_Budget holds Revised_Budget, "
                    "Revised_Budget holds YTD_Actual); Fiscal_Year, Account_Type and YTD_Actual are empty for all 1,061 rows.",
                    "Fiscal year cannot be attributed and actuals are year-to-date, so the layer is not used for calibration."]}
    out["permits_S10"] = {"usable": False, "quality": ["Columns are shifted (dates in Type_of_Work, owners in PIN); not used."]}
    out["audits_S42"] = {"usable": False, "quality": ["Direct retrieval returned HTTP 403 from this environment."]}
    (PROCESSED / "local_evidence.json").write_text(json.dumps(out, indent=2, default=str))
    return out


if __name__ == "__main__":
    o = build()
    tb = o["taxable_base"]
    print(f"taxable base ${tb['town_taxable_assessed_value']/1e9:.2f}B; restricted units "
          f"{o['restricted_inventory']['restricted_units_chapel_hill']}; dev lags {o['housing_grants']['development_completion_lag_years']}")
