# ERD Overview (v1)

## Entities

### users

- `id` UUID PK
- `telegram_user_id` BIGINT UNIQUE
- `username` TEXT NULL
- `first_name` TEXT
- `last_name` TEXT NULL
- `created_at` TIMESTAMPTZ
- `updated_at` TIMESTAMPTZ

### profiles

- `user_id` UUID PK, FK -> users.id
- `timezone` TEXT
- `height_cm` SMALLINT NULL
- `weight_kg` NUMERIC(5,2) NULL
- `goal_type` TEXT NULL (`lose`, `maintain`, `gain`)
- `created_at` TIMESTAMPTZ
- `updated_at` TIMESTAMPTZ

### daily_goals

- `id` UUID PK
- `user_id` UUID FK -> users.id
- `calories` INTEGER
- `protein_g` INTEGER
- `carbs_g` INTEGER
- `fat_g` INTEGER
- `effective_from` DATE
- `created_at` TIMESTAMPTZ

### meals

- `id` UUID PK
- `user_id` UUID FK -> users.id
- `meal_type` TEXT (`breakfast`, `lunch`, `dinner`, `snack`)
- `title` TEXT
- `eaten_at` TIMESTAMPTZ
- `source` TEXT (`manual`, `ai`)
- `created_at` TIMESTAMPTZ
- `updated_at` TIMESTAMPTZ

### meal_items

- `id` UUID PK
- `meal_id` UUID FK -> meals.id
- `name` TEXT
- `grams` NUMERIC(7,2) NULL
- `calories` INTEGER
- `protein_g` NUMERIC(7,2)
- `carbs_g` NUMERIC(7,2)
- `fat_g` NUMERIC(7,2)
- `confidence` NUMERIC(4,3) NULL

### daily_summaries

- `id` UUID PK
- `user_id` UUID FK -> users.id
- `day` DATE
- `total_calories` INTEGER
- `total_protein_g` NUMERIC(7,2)
- `total_carbs_g` NUMERIC(7,2)
- `total_fat_g` NUMERIC(7,2)
- `meal_count` INTEGER
- `updated_at` TIMESTAMPTZ

### scan_jobs

- `id` UUID PK
- `user_id` UUID FK -> users.id
- `status` TEXT (`queued`, `processing`, `succeeded`, `failed`)
- `image_url` TEXT
- `error_code` TEXT NULL
- `created_at` TIMESTAMPTZ
- `updated_at` TIMESTAMPTZ

### scan_results

- `id` UUID PK
- `scan_job_id` UUID UNIQUE FK -> scan_jobs.id
- `dish_name` TEXT
- `calories` INTEGER
- `protein_g` NUMERIC(7,2)
- `carbs_g` NUMERIC(7,2)
- `fat_g` NUMERIC(7,2)
- `confidence` NUMERIC(4,3)
- `alternatives_json` JSONB
- `created_at` TIMESTAMPTZ

### streaks

- `user_id` UUID PK FK -> users.id
- `current_streak_days` INTEGER
- `longest_streak_days` INTEGER
- `last_logged_day` DATE NULL
- `updated_at` TIMESTAMPTZ

### achievements

- `id` UUID PK
- `key` TEXT UNIQUE
- `title` TEXT
- `description` TEXT
- `rule_json` JSONB
- `created_at` TIMESTAMPTZ

### user_achievements

- `id` UUID PK
- `user_id` UUID FK -> users.id
- `achievement_id` UUID FK -> achievements.id
- `unlocked_at` TIMESTAMPTZ
- UNIQUE(`user_id`, `achievement_id`)

### events

- `id` UUID PK
- `user_id` UUID NULL FK -> users.id
- `event_name` TEXT
- `payload_json` JSONB
- `created_at` TIMESTAMPTZ

## Indexes (minimum)

- `meals(user_id, eaten_at DESC)`
- `daily_summaries(user_id, day)`
- `scan_jobs(user_id, created_at DESC)`
- `events(event_name, created_at DESC)`
