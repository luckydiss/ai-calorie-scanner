"""add user progression table

Revision ID: 20260312_0005
Revises: 20260312_0004
Create Date: 2026-03-12
"""

from __future__ import annotations

from alembic import op


revision = "20260312_0005"
down_revision = "20260312_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_progression (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
          current_xp INTEGER NOT NULL DEFAULT 0 CHECK (current_xp >= 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def downgrade() -> None:
    pass
