-- Migration 005: Add carbs and fat targets to user_goals
-- Idempotent: bruger ADD COLUMN IF NOT EXISTS

ALTER TABLE user_goals ADD COLUMN IF NOT EXISTS target_carbs_g INTEGER;
ALTER TABLE user_goals ADD COLUMN IF NOT EXISTS target_fat_g INTEGER;
