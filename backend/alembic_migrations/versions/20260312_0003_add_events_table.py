"""add events table for activity tracking

Revision ID: 20260312_0003
Revises: 20260312_0002
Create Date: 2026-03-12
"""

from __future__ import annotations

from alembic import op


revision = "20260312_0003"
down_revision = "20260312_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          event_name TEXT NOT NULL,
          payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_events_name_created_at ON events (event_name, created_at DESC)")


def downgrade() -> None:
    # Production downgrades are intentionally conservative for data safety.
    pass
