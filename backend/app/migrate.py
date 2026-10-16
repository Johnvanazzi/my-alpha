"""Bring the database schema up to date with Alembic on startup."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.db import engine

BACKEND_DIR = Path(__file__).resolve().parent.parent
# Databases created before Alembic was introduced already have this schema.
PRE_ALEMBIC_REVISION = "0001"


def run_migrations() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "app" / "migrations"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        tables = set(inspect(connection).get_table_names())
        if "portfolios" in tables and "alembic_version" not in tables:
            command.stamp(config, PRE_ALEMBIC_REVISION)
        command.upgrade(config, "head")
