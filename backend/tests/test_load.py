"""Evidence refreshes (chsim.ingest.load.replace_all): atomic, and safe with enforced foreign keys."""
import pandas as pd
import pytest
from sqlalchemy import create_engine, event, select, func
from chsim.store import models as M
from chsim.ingest.load import replace_all


@pytest.fixture
def db():
    eng = create_engine("sqlite://")
    event.listen(eng, "connect", lambda con, _: con.execute("PRAGMA foreign_keys=ON"))  # enforce FKs, as PostgreSQL does
    M.Base.metadata.create_all(eng)
    return eng


def areas(*ids):
    return pd.DataFrame([{"geoid": g, "vintage": "2020", "kind": "tract", "county": "135", "name": g, "lat": 0.0, "lon": 0.0} for g in ids])


def members(*ids):
    return pd.DataFrame([{"area_geoid": g, "jurisdiction": "3711800", "year": 2020, "weight": .5, "rule": "test"} for g in ids])


def count(eng, model):
    with eng.connect() as c:
        return c.execute(select(func.count()).select_from(model)).scalar()


def test_reloading_a_populated_store_respects_foreign_keys(db):
    # Membership rows reference Area; the second load must clear them before their areas and write areas first.
    replace_all([(M.Membership.__table__, members("A", "B")), (M.Area.__table__, areas("A", "B"))], bind=db)
    replace_all([(M.Area.__table__, areas("A", "C")), (M.Membership.__table__, members("C"))], bind=db)
    assert count(db, M.Area) == 2 and count(db, M.Membership) == 1


def test_a_failed_refresh_keeps_the_old_data(db):
    replace_all([(M.Area.__table__, areas("A", "B")), (M.Membership.__table__, members("A"))], bind=db)
    with pytest.raises(Exception):  # a membership pointing at a missing area fails mid-refresh
        replace_all([(M.Area.__table__, areas("X")), (M.Membership.__table__, members("NOPE"))], bind=db)
    assert count(db, M.Area) == 2 and count(db, M.Membership) == 1
