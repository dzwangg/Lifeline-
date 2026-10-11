"""Canonical tables (dossier section 14). SQLite locally; Postgres/PostGIS (e.g. Tiger Cloud) via DATABASE_URL.

Geometry is kept as GeoJSON text so the same schema runs on SQLite; on PostGIS a migration can add geometry columns.
"""
from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text, DateTime, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

now = lambda: datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class SourceAsset(Base):
    __tablename__ = "source_asset"
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[str] = mapped_column(String(8), index=True)
    title: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(Text)
    file: Mapped[str | None] = mapped_column(String(300))
    sha256: Mapped[str | None] = mapped_column(String(64))
    retrieved_at: Mapped[str | None] = mapped_column(String(40))
    access_result: Mapped[str] = mapped_column(String(80))
    coverage: Mapped[dict | None] = mapped_column(JSON)


class Area(Base):
    __tablename__ = "area"
    geoid: Mapped[str] = mapped_column(String(20), primary_key=True)
    vintage: Mapped[str] = mapped_column(String(20), default="2020")
    kind: Mapped[str] = mapped_column(String(20))  # tract | place | external
    county: Mapped[str | None] = mapped_column(String(5))
    name: Mapped[str | None] = mapped_column(String(120))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)


class Membership(Base):
    __tablename__ = "membership"
    id: Mapped[int] = mapped_column(primary_key=True)
    area_geoid: Mapped[str] = mapped_column(ForeignKey("area.geoid"), index=True)
    jurisdiction: Mapped[str] = mapped_column(String(20))  # e.g. place 3711800
    year: Mapped[int] = mapped_column(Integer)
    weight: Mapped[float] = mapped_column(Float)
    rule: Mapped[str] = mapped_column(String(80))  # e.g. "lodes-block-jobs", "area-overlap (approximation)"


class AreaObservation(Base):
    __tablename__ = "area_observation"
    __table_args__ = (UniqueConstraint("area_geoid", "concept", "ref_start", "ref_end", "source_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    area_geoid: Mapped[str] = mapped_column(String(20), index=True)
    concept: Mapped[str] = mapped_column(String(60), index=True)
    ref_start: Mapped[str] = mapped_column(String(10))
    ref_end: Mapped[str] = mapped_column(String(10))
    value: Mapped[float | None] = mapped_column(Float)  # None = missing; status distinguishes suppressed
    moe: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(20), default="observed")  # observed | missing | suppressed | nowcast
    source_id: Mapped[str] = mapped_column(String(8))
    release: Mapped[str | None] = mapped_column(String(40))


class GraphRelation(Base):
    __tablename__ = "graph_relation"
    id: Mapped[int] = mapped_column(primary_key=True)
    src: Mapped[str] = mapped_column(String(20), index=True)
    dst: Mapped[str] = mapped_column(String(20), index=True)
    relation: Mapped[str] = mapped_column(String(20))  # adjacency | commute (src=home, dst=work)
    year: Mapped[int | None] = mapped_column(Integer)
    weight: Mapped[float] = mapped_column(Float)
    source_id: Mapped[str] = mapped_column(String(8))


class MunicipalFiscal(Base):
    __tablename__ = "municipal_fiscal"
    id: Mapped[int] = mapped_column(primary_key=True)
    town: Mapped[str] = mapped_column(String(20))
    fund: Mapped[str] = mapped_column(String(60))
    fiscal_year: Mapped[int] = mapped_column(Integer)  # FY ending June 30
    concept: Mapped[str] = mapped_column(String(60))
    kind: Mapped[str] = mapped_column(String(20))  # actual | adopted | estimate | illustrative
    value: Mapped[float | None] = mapped_column(Float)
    basis: Mapped[str] = mapped_column(String(40))
    source_id: Mapped[str] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(Text)


class ProjectEvent(Base):
    __tablename__ = "project_event"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[str] = mapped_column(String(80), index=True)
    pin: Mapped[str | None] = mapped_column(String(20))
    event: Mapped[str] = mapped_column(String(30))  # approved | completed | ...
    fiscal_year: Mapped[int | None] = mapped_column(Integer)
    units_new: Mapped[float | None] = mapped_column(Float)
    units_preserved: Mapped[float | None] = mapped_column(Float)
    dollars: Mapped[float | None] = mapped_column(Float)
    source_id: Mapped[str] = mapped_column(String(8))


class PolicyTreatment(Base):
    """Empty until applicant/award/outcome records are acquired (dossier section 15)."""
    __tablename__ = "policy_treatment"
    id: Mapped[int] = mapped_column(primary_key=True)
    program: Mapped[str] = mapped_column(String(60))
    version: Mapped[str] = mapped_column(String(20))
    applicant: Mapped[str] = mapped_column(String(120))
    decision: Mapped[str | None] = mapped_column(String(20))
    paid_amount: Mapped[float | None] = mapped_column(Float)
    paid_date: Mapped[str | None] = mapped_column(String(10))
    comparison_status: Mapped[str | None] = mapped_column(String(30))
    source_id: Mapped[str] = mapped_column(String(20))


class Scenario(Base):
    __tablename__ = "scenario"
    hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    spec: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Job(Base):
    __tablename__ = "job"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    scenario_hash: Mapped[str] = mapped_column(ForeignKey("scenario.hash"), index=True)
    result_key: Mapped[str] = mapped_column(String(64), index=True)  # scenario+model+data+effects hash
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | done | error
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class ScenarioResult(Base):
    __tablename__ = "scenario_result"
    result_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    scenario_hash: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
