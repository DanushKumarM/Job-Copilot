"""Integration tests run against a real PostgreSQL database (design 15.1), migrated with Alembic.

Set JOBCOPILOT_TEST_DATABASE_URL, e.g. postgresql+psycopg://postgres@localhost:5433/jobcopilot_test.
Each test runs inside a transaction that is rolled back.
"""

import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from procrastinate.testing import InMemoryConnector
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from jobcopilot import worker
from jobcopilot.config import get_settings

BACKEND = Path(__file__).resolve().parents[1]
TEST_DB_URL = os.environ.get(
    "JOBCOPILOT_TEST_DATABASE_URL", "postgresql+psycopg://postgres@localhost:5433/jobcopilot_test"
)


@pytest.fixture(scope="session")
def engine():
    engine = create_engine(TEST_DB_URL)
    try:
        engine.connect().close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"test database unavailable: {exc}")
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    config.attributes["database_url"] = TEST_DB_URL
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    yield engine
    engine.dispose()


@pytest.fixture
def session(engine):
    with engine.connect() as connection:
        transaction = connection.begin()
        with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as s:
            yield s
        transaction.rollback()


@pytest.fixture(autouse=True)
def file_root(tmp_path, monkeypatch):
    monkeypatch.setenv("JOBCOPILOT_FILE_ROOT", str(tmp_path / "files"))
    get_settings.cache_clear()
    yield tmp_path / "files"
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def queue():
    """Tasks deferred during a test land in memory, never in a real database queue."""
    connector = InMemoryConnector()
    with worker.app.replace_connector(connector):
        yield connector
