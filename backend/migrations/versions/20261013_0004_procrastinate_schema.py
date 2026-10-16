"""procrastinate job queue schema

Installs the schema of the installed procrastinate version (pinned to 3.10.x in pyproject.toml).
When upgrading procrastinate, add a migration that runs its bundled SQL migrations for the new version
(see procrastinate.schema.SchemaManager.get_migrations_path()).

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-13
"""

from collections.abc import Sequence

from alembic import op
from procrastinate.schema import SchemaManager

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("procrastinate_events", "procrastinate_periodic_defers", "procrastinate_jobs", "procrastinate_workers")
TYPES = ("procrastinate_job_to_defer_v1", "procrastinate_job_event_type", "procrastinate_job_status")


def upgrade() -> None:
    op.execute(SchemaManager.get_schema())


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    # Functions are versioned (..._v1, _v2); drop every procrastinate function whatever its signature.
    op.execute(
        """
        DO $$
        DECLARE fn regprocedure;
        BEGIN
            FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p
                      JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = current_schema() AND p.proname LIKE 'procrastinate\\_%'
            LOOP
                EXECUTE 'DROP FUNCTION ' || fn || ' CASCADE';
            END LOOP;
        END $$;
        """
    )
    for type_ in TYPES:
        op.execute(f"DROP TYPE IF EXISTS {type_} CASCADE")
