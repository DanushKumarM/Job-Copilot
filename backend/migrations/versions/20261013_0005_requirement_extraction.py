"""requirement extraction: retire requirements instead of deleting them; record the extractor per job

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-13 22:40:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Old evaluations keep pointing at the requirements they scored, so a re-extraction retires rows.
    op.add_column("job_requirements", sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("jobs", sa.Column("extractor_version", sa.String(length=32), nullable=True))
    op.execute(
        "UPDATE jobs SET extractor_version = 'rules-v1' "
        "WHERE EXISTS (SELECT 1 FROM job_requirements r WHERE r.job_id = jobs.id)"
    )


def downgrade() -> None:
    op.drop_column("jobs", "extractor_version")
    op.drop_column("job_requirements", "retired_at")
