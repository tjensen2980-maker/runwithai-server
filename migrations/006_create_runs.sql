-- Migration 006: Create runs table for staging environment
-- This matches the production schema for runs (originally created manually)

CREATE TABLE IF NOT EXISTS runs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TIMESTAMPTZ DEFAULT NOW(),
  km NUMERIC,
  duration INTEGER,
  pace NUMERIC,
  calories INTEGER,
  heart_rate INTEGER,
  route JSONB,
  notes TEXT,
  type TEXT DEFAULT 'run',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  running_km NUMERIC,
  walking_km NUMERIC,
  max_hr INTEGER,
  cadence INTEGER,
  total_ascent NUMERIC,
  total_descent NUMERIC,
  total_steps INTEGER,
  splits JSONB,
  hr_samples JSONB
);

CREATE INDEX IF NOT EXISTS idx_runs_user_date ON runs(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_runs_user_created ON runs(user_id, created_at DESC);

-- Optional related tables that may be needed
CREATE TABLE IF NOT EXISTS challenges (
  id SERIAL PRIMARY KEY,
  creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  goal_km NUMERIC,
  start_date DATE,
  end_date DATE,
  invite_code TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS challenge_participants (
  id SERIAL PRIMARY KEY,
  challenge_id INTEGER REFERENCES challenges(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  total_km NUMERIC DEFAULT 0,
  UNIQUE(challenge_id, user_id)
);

CREATE TABLE IF NOT EXISTS streak_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  km NUMERIC,
  UNIQUE(user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_challenges_creator ON challenges(creator_id);
CREATE INDEX IF NOT EXISTS idx_challenges_invite ON challenges(invite_code);
CREATE INDEX IF NOT EXISTS idx_challenge_participants_user ON challenge_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_challenge_participants_challenge ON challenge_participants(challenge_id);
CREATE INDEX IF NOT EXISTS idx_streak_log_user_date ON streak_log(user_id, log_date);