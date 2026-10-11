"""Plain-language mechanism notes per card. Static text: it explains the modules; it creates no numbers."""

CARD_TEXT = {
    "small_business_support_grant": {
        "title": "Small-Business Support Grant",
        "evidence_grade": "assumption_only",
        "mechanism": "Eligible existing establishments apply; awards are capped by budget and applications. A grant lowers a "
                     "recipient's closure hazard by a dose-dependent amount that can be zero. Only avoided closures count, "
                     "net of displacement of competitors; most funded businesses would have stayed open anyway.",
        "delays": "Effects start in the award year; saved establishments then face ordinary closure risk.",
        "constraints": "Recipients are capped by the assumed eligible stock and take-up; unspent budget is reported.",
        "missing_evidence": "Applicant, award, rejection and survival records (Town Economic Development, Orange County).",
    },
    "new_business_startup_grant": {
        "title": "New-Business Startup Grant",
        "evidence_grade": "assumption_only",
        "mechanism": "Applications -> eligible awards -> disbursement -> incremental openings after additionality. Openings are "
                     "split into new establishments and relocations; survival and competitor crowd-out follow.",
        "delays": "Openings occur one year after the award; first-year survival is below later survival.",
        "constraints": "Awards are capped by eligible applications and budget.",
        "missing_evidence": "Applicant and award histories with actual opening and survival dates.",
    },
    "hiring_subsidy": {
        "title": "Hiring Subsidy",
        "evidence_grade": "assumption_only",
        "mechanism": "Subsidised qualifying hires minus deadweight (hires that would happen anyway) and substitution give "
                     "additional workplace jobs; resident employment rises only by the share filled by town residents.",
        "delays": "Jobs persist while subsidised; after support ends a retention share survives, then separations continue.",
        "constraints": "Qualifying hires are capped by the eligible hiring pool, budget and labour availability.",
        "missing_evidence": "Employer contracts, reimbursed wages, headcount/retention outcomes and comparison cohorts.",
    },
    "housing_construction_subsidy": {
        "title": "Housing Construction Subsidy",
        "evidence_grade": "assumption_only (delays: observed local distribution)",
        "mechanism": "Budget funds units up to an assumed feasible capacity. Funded projects move through the pipeline and "
                     "complete after a delay drawn from the town's observed approval-to-completion lags (S13), at least one "
                     "year; some fail. Only the additional share adds housing supply; restrictions apply to funded units and "
                     "expire after the chosen term. Preservation restricts existing homes and adds no units.",
        "delays": "No same-year homes: completions follow funding by one to five years.",
        "constraints": "Zoning, sewer capacity, flood, wetland and soil constraints were not acquired; an assumed annual "
                       "capacity cap stands in and is labelled. Half the award is paid at funding, half at completion; the "
                       "unpaid half is encumbered.",
        "missing_evidence": "Complete permit/certificate-of-occupancy histories, financing stacks and OWASA capacity decisions.",
    },
    "property_tax_adjustment": {
        "title": "Property Tax Adjustment",
        "evidence_grade": "observed_arithmetic (levy); behavioural response not identified",
        "mechanism": "Town levy = town-taxable base x rate in cents per $100 / 10,000, times a collection rate. Only the town "
                     "component changes; county, school and district rates are separate. Lower taxes are not assumed to "
                     "cause growth.",
        "delays": "Applies from the effective fiscal year for the chosen duration.",
        "constraints": "The base is an unaudited current parcel snapshot grown by an assumed rate.",
        "missing_evidence": "Annual assessment rolls, exemptions and collection history.",
    },
}
