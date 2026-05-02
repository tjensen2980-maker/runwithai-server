CREATE TABLE IF NOT EXISTS daily_summary (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  kcal_in INT NOT NULL DEFAULT 0,
  kcal_out_activity INT NOT NULL DEFAULT 0,
  kcal_out_bmr INT NOT NULL DEFAULT 0,
  protein_g INT NOT NULL DEFAULT 0,
  carbs_g INT NOT NULL DEFAULT 0,
  fat_g INT NOT NULL DEFAULT 0,
  steps INT,
  sleep_hours NUMERIC,
  weight_kg NUMERIC,
  resting_hr INT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS user_goals (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  primary_goal TEXT CHECK (primary_goal IN ('lose_fat','gain_muscle','run_faster','run_longer','maintain')),
  target_weight_kg NUMERIC,
  target_kcal INT,
  target_protein_g INT,
  weekly_run_km NUMERIC,
  weekly_strength_sessions INT,
  race_date DATE,
  race_distance_km NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  context_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coach_messages_user_created ON coach_messages(user_id, created_at DESC);