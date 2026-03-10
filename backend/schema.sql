CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  height_cm SMALLINT,
  weight_kg NUMERIC(5,2),
  goal_type TEXT CHECK (goal_type IN ('lose', 'maintain', 'gain')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE daily_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calories INTEGER NOT NULL CHECK (calories > 0),
  protein_g INTEGER NOT NULL CHECK (protein_g >= 0),
  carbs_g INTEGER NOT NULL CHECK (carbs_g >= 0),
  fat_g INTEGER NOT NULL CHECK (fat_g >= 0),
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  title TEXT NOT NULL,
  eaten_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE meal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  grams NUMERIC(7,2),
  calories INTEGER NOT NULL CHECK (calories >= 0),
  protein_g NUMERIC(7,2) NOT NULL CHECK (protein_g >= 0),
  carbs_g NUMERIC(7,2) NOT NULL CHECK (carbs_g >= 0),
  fat_g NUMERIC(7,2) NOT NULL CHECK (fat_g >= 0),
  confidence NUMERIC(4,3)
);

CREATE TABLE daily_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  total_calories INTEGER NOT NULL DEFAULT 0 CHECK (total_calories >= 0),
  total_protein_g NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (total_protein_g >= 0),
  total_carbs_g NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (total_carbs_g >= 0),
  total_fat_g NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (total_fat_g >= 0),
  meal_count INTEGER NOT NULL DEFAULT 0 CHECK (meal_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, day)
);

CREATE TABLE scan_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  image_url TEXT NOT NULL,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scan_results (
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
);

CREATE TABLE streaks (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak_days INTEGER NOT NULL DEFAULT 0 CHECK (current_streak_days >= 0),
  longest_streak_days INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak_days >= 0),
  last_logged_day DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  rule_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, achievement_id)
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meals_user_eaten_at ON meals (user_id, eaten_at DESC);
CREATE INDEX idx_daily_summaries_user_day ON daily_summaries (user_id, day);
CREATE INDEX idx_scan_jobs_user_created_at ON scan_jobs (user_id, created_at DESC);
CREATE INDEX idx_events_name_created_at ON events (event_name, created_at DESC);
