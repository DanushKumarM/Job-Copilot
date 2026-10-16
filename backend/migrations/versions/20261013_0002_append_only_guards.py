"""append-only guards on history tables

History tables reject UPDATE always, and DELETE unless the owning row is already gone, which only
happens inside an ON DELETE CASCADE from erasing a user's data (design 12.5, 14).

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-13
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APPEND_ONLY_TABLES = (
    ("application_events", "applications", "application_id"),
    ("audit_log", "users", "user_id"),
)


def upgrade() -> None:
    for table, owner_table, owner_column in APPEND_ONLY_TABLES:
        op.execute(
            f"""
            CREATE FUNCTION {table}_guard() RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'DELETE'
                    AND OLD.{owner_column} IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM {owner_table} WHERE id = OLD.{owner_column})
                THEN
                    RETURN OLD;
                END IF;
                RAISE EXCEPTION '{table} is append-only';
            END;
            $$ LANGUAGE plpgsql;
            """
        )
        op.execute(
            f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {table}_guard()"
        )


def downgrade() -> None:
    for table, _, _ in APPEND_ONLY_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS {table}_append_only ON {table}")
        op.execute(f"DROP FUNCTION IF EXISTS {table}_guard()")
