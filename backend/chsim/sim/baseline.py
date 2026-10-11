"""Current-policy baseline for town jobs. No machine learning: nothing is fitted or trained.

Persistence: the last observed LODES year (2023) is carried forward, so the median path is flat (no growth is assumed).
Year-to-year spread comes from resampling the town's own observed annual log changes 2009-2023, demeaned so they add
noise but no trend. Workplace and resident jobs use the same resampled year in a draw (shared shocks).
2024-2026 are nowcast years, 2027+ projections.
"""
from __future__ import annotations
from functools import lru_cache
import numpy as np
import pandas as pd
from ..config import PROCESSED, DATA_VERSION, LAST_OBSERVED_YEAR

DRAWS, HORIZON, SEED = 500, 13, 2023  # 2024..2036
VERSION = f"persistence.v1.{DATA_VERSION}"


@lru_cache(maxsize=1)
def load_current() -> tuple[dict, dict]:
    t = pd.read_csv(PROCESSED / "lodes_town_year.csv").sort_values("year")
    jobs, rac = t.workplace_jobs.to_numpy(float), t.resident_primary_jobs.to_numpy(float)
    dj, dr = np.diff(np.log(jobs)), np.diff(np.log(rac))
    dj, dr = dj - dj.mean(), dr - dr.mean()  # spread only, no trend
    rng = np.random.default_rng(SEED)
    pick = rng.integers(0, len(dj), (DRAWS, HORIZON))
    town_jobs = jobs[-1] * np.exp(np.cumsum(dj[pick], 1))
    town_rac = rac[-1] * np.exp(np.cumsum(dr[pick], 1))
    years = list(range(LAST_OBSERVED_YEAR + 1, LAST_OBSERVED_YEAR + 1 + HORIZON))
    meta = {"model_version": VERSION, "model": "persistence (no ML)", "data_version": DATA_VERSION,
            "origin_observed_year": LAST_OBSERVED_YEAR, "years": years, "nowcast_years": [y for y in years if y <= 2026],
            "draws": DRAWS, "method": __doc__.strip(),
            "observed_town_jobs_2023": float(jobs[-1]), "observed_town_rac_2023": float(rac[-1])}
    return meta, {"years": np.array(years), "town_jobs": town_jobs, "town_rac": town_rac}
