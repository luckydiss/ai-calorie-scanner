"""add language preference to profiles

Revision ID: 20260312_0004
Revises: 20260312_0003
Create Date: 2026-03-12
"""

from __future__ import annotations

from alembic import op


revision = "20260312_0004"
down_revision = "20260312_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language TEXT")


def downgrade() -> None:
    # Production downgrades are intentionally conservative for data safety.
    pass
