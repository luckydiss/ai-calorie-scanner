"""add streaks and achievements tables

Revision ID: 20260312_0002
Revises: 20260310_0001
Create Date: 2026-03-12
"""

from __future__ import annotations

from alembic import op


revision = "20260312_0002"
down_revision = "20260310_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS streaks (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          current_streak_days INTEGER NOT NULL DEFAULT 0 CHECK (current_streak_days >= 0),
          longest_streak_days INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak_days >= 0),
          last_logged_day DATE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS achievements (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          key TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          rule_json JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_achievements (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
          unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, achievement_id)
        )
        """
    )


def downgrade() -> None:
    # Keep history for safety.
    pass
