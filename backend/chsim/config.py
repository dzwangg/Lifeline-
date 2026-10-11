"""Paths, geography identifiers and version strings shared across the backend."""
from pathlib import Path
import os

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent
RAW = BACKEND / "data" / "raw"            # immutable downloaded snapshots (git-ignored)
PROCESSED = BACKEND / "data" / "processed"  # canonical tables derived from RAW, versioned by DATA_VERSION
SITE_DATA = REPO / "data" / "forecast"     # static results the website can load without a server

STATE_FIPS = "37"
CHAPEL_HILL_PLACE = "3711800"              # dossier: Chapel Hill place FIPS 3711800
TOWN_COUNTIES = {"37135": "Orange", "37063": "Durham"}  # the town spans both
# Regional graph context: both town counties plus neighbors that exchange commuters (dossier section 2).
REGION_COUNTIES = {**TOWN_COUNTIES, "37183": "Wake", "37037": "Chatham", "37001": "Alamance"}
PANEL_YEARS = list(range(2009, 2024))      # proposed common panel; LODES verified through 2023
LAST_OBSERVED_YEAR = 2023
FORECAST_ORIGIN = 2026                     # 2024-2026 are nowcast years, not observations

DATA_VERSION = "lodes8-2009-2023.tiger2020.v1"
EFFECTS_VERSION = "effects.v1-assumption"
BENCHMARK_VERSION = "targets.v1-illustrative"

DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{(BACKEND / 'chsim.db').as_posix()}")
