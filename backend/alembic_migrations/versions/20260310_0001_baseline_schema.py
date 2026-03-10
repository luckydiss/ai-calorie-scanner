"""baseline schema for calorie food backend

Revision ID: 20260310_0001
Revises:
Create Date: 2026-03-10
"""

from __future__ import annotations

from alembic import op


revision = "20260310_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          telegram_user_id BIGINT NOT NULL UNIQUE,
          username TEXT,
          first_name TEXT NOT NULL,
          last_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS profiles (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          timezone TEXT NOT NULL DEFAULT 'UTC',
          height_cm SMALLINT,
          weight_kg NUMERIC(5,2),
          goal_type TEXT CHECK (goal_type IN ('lose', 'maintain', 'gain')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS daily_goals (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          calories INTEGER NOT NULL CHECK (calories > 0),
          protein_g INTEGER NOT NULL CHECK (protein_g >= 0),
          carbs_g INTEGER NOT NULL CHECK (carbs_g >= 0),
          fat_g INTEGER NOT NULL CHECK (fat_g >= 0),
          effective_from DATE NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS meals (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
          title TEXT NOT NULL,
          eaten_at TIMESTAMPTZ NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS meal_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          meal_id UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          grams NUMERIC(7,2),
          calories INTEGER NOT NULL CHECK (calories >= 0),
          protein_g NUMERIC(7,2) NOT NULL CHECK (protein_g >= 0),
          carbs_g NUMERIC(7,2) NOT NULL CHECK (carbs_g >= 0),
          fat_g NUMERIC(7,2) NOT NULL CHECK (fat_g >= 0),
          confidence NUMERIC(4,3)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scan_jobs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          image_url TEXT NOT NULL,
          error_code TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          confirmed_at TIMESTAMPTZ
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scan_results (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          scan_job_id UUID NOT NULL UNIQUE REFERENCES scan_jobs(id) ON DELETE CASCADE,
          dish_name TEXT NOT NULL,
          calories INTEGER NOT NULL CHECK (calories >= 0),
          protein_g NUMERIC(7,2) NOT NULL CHECK (protein_g >= 0),
          carbs_g NUMERIC(7,2) NOT NULL CHECK (carbs_g >= 0),
          fat_g NUMERIC(7,2) NOT NULL CHECK (fat_g >= 0),
          confidence NUMERIC(4,3) NOT NULL,
          alternatives_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )

    op.execute(
        """
        ALTER TABLE scan_jobs DROP CONSTRAINT IF EXISTS scan_jobs_status_check
        """
    )
    op.execute(
        """
        ALTER TABLE scan_jobs
        ADD CONSTRAINT scan_jobs_status_check
        CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'cancelled'))
        """
    )

    op.execute("CREATE INDEX IF NOT EXISTS idx_meals_user_eaten_at ON meals(user_id, eaten_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_goals_user_effective_from ON daily_goals(user_id, effective_from DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_scan_jobs_user_created_at ON scan_jobs(user_id, created_at DESC)")


def downgrade() -> None:
    # Production downgrades are intentionally conservative for data safety.
    pass
