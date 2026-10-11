"""Source register: the dossier's IDs (S01-S68) for the sources this backend actually touches.

`status` records what happened in this repository's ingestion, not what the dossier promised.
"""
TOWN_GIS = "https://gis-portal.townofchapelhill.org/server/rest/services/OpenData"
TOWN_HOSTED = "https://services2.arcgis.com/7KRXAKALbBGlCW77/ArcGIS/rest/services"
LODES = "https://lehd.ces.census.gov/data/lodes/LODES8/nc"

SOURCES = {
    "S01": {"title": "Chapel Hill corporate limits", "url": f"{TOWN_GIS}/Corporate_Limits/MapServer/0",
            "kind": "arcgis", "use": "Policy eligibility geography (current limits)."},
    "S02": {"title": "Census TIGER/Line 2020 tracts and places",
            "url": "https://www2.census.gov/geo/tiger/TIGER2020/", "kind": "tiger",
            "use": "Fixed 2020 tract nodes, adjacency, place boundary."},
    "S04": {"title": "All Parcels composite (Orange/Durham)", "url": f"{TOWN_GIS}/AllParcels/MapServer/0", "kind": "arcgis",
            "use": "Parcel fabric. Not yet ingested."},
    "S05": {"title": "Orange County parcel attributes", "url": f"{TOWN_GIS}/OrangeCountyParcels/MapServer/0", "kind": "arcgis",
            "use": "Taxable/exempt values. Current snapshot only; not an assessment history."},
    "S06": {"title": "Durham County parcel attributes", "url": f"{TOWN_GIS}/DurhamCountyParcels/MapServer/0", "kind": "arcgis",
            "use": "Durham-side taxable values. Current snapshot only."},
    "S10": {"title": "Historical permits 2013-2016", "url": f"{TOWN_HOSTED}/Permits_Issued_2013_to_2016/FeatureServer/0",
            "kind": "arcgis", "use": "Permit events (issued is not completed)."},
    "S13": {"title": "Affordable housing grants inventory",
            "url": f"{TOWN_HOSTED}/Affordable_Housing_Grants_Inventory_PublicView/FeatureServer/9", "kind": "arcgis",
            "use": "Funding-to-delivery evidence for the housing card."},
    "S16": {"title": "Subsidized housing inventory FY2025", "url": f"{TOWN_HOSTED}/Affordable_Housing_Data_2025/FeatureServer/6",
            "kind": "arcgis", "use": "Restricted stock and affordability end dates."},
    "S21": {"title": "ACS 5-year detailed tables", "url": "https://api.census.gov/data/{year}/acs/acs5", "kind": "acs",
            "use": "Rent, burden, housing context. Requires CENSUS_API_KEY."},
    "S24": {"title": "LODES8 North Carolina", "url": f"{LODES}/", "kind": "lodes",
            "use": "Workplace (WAC) and residence (RAC) primary jobs, OD commuting flows, block crosswalk."},
    "S36": {"title": "Downtown tenants (stale 2020)", "url": f"{TOWN_HOSTED}/Downtown_Tenants/FeatureServer/0", "kind": "arcgis",
            "use": "Limited downtown business open/close sample; not a townwide registry."},
    "S42": {"title": "Chapel Hill audited financial statements",
            "url": "https://www.chapelhillnc.gov/Town-Government/Financials/Annual-Financial-Statements", "kind": "pdf",
            "use": "Audited fiscal calibration. Direct retrieval returns HTTP 403 here."},
    "S44": {"title": "Structured Budget and Actuals FY2016-2019", "url": f"{TOWN_HOSTED}/Budget_and_Actuals/FeatureServer/0",
            "kind": "arcgis", "use": "Short structured fiscal bridge (July-June fiscal years)."},
    "S46": {"title": "Orange County tax rates", "url": "https://www.orangecountync.gov/897/Tax-Rates-and-Fees-Information",
            "kind": "web", "use": "Town rate component; county/school rates kept separate."},
}
