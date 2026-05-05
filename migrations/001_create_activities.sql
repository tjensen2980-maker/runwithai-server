CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Generaliseret aktivitetstabel (løb, gang, cykling, styrke, mobility, andet)
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('run','walk','bike','strength','mobility','other')),
  started_at TIMESTAMPTZ NOT NULL,
  duration_sec INT,
  calories_kcal INT,
  avg_hr INT,
  max_hr INT,
  perceived_effort INT CHECK (perceived_effort BETWEEN 1 AND 10),
  notes TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_user_started ON activities(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);

-- Løb-specifikke felter (1:1 med activities hvor type='run')
CREATE TABLE IF NOT EXISTS activity_run_details (
  activity_id UUID PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  distance_m INT,
  avg_pace_sec_per_km INT,
  total_ascent_m NUMERIC,
  total_descent_m NUMERIC,
  total_steps INT,
  cadence_avg INT,
  splits JSONB,
  hr_samples JSONB,
  gps_polyline TEXT
);