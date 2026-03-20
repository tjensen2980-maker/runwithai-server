-- ═══════════════════════════════════════════════════════════════════════════════
-- RunWithAI — Social Challenges & Streaks Migration
-- Run this against your Railway PostgreSQL database
-- ═══════════════════════════════════════════════════════════════════════════════

-- Challenges table: stores challenge definitions created by users
CREATE TABLE IF NOT EXISTS challenges (
  id SERIAL PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(50) NOT NULL DEFAULT 'streak',
  -- Types: 'streak' (consecutive days), 'distance' (total km), 'frequency' (runs per week)
  target_value NUMERIC NOT NULL,
  -- For streak: number of days. For distance: total km. For frequency: runs per period.
  target_period VARCHAR(20) DEFAULT 'week',
  -- 'day', 'week', 'month'
  start_date TIMESTAMP NOT NULL DEFAULT NOW(),
  end_date TIMESTAMP,
  -- NULL = ongoing/infinite
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  -- 'active', 'completed', 'canceled'
  invite_code VARCHAR(20) UNIQUE,
  -- Short code for sharing/joining
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Challenge participants: who has joined a challenge
CREATE TABLE IF NOT EXISTS challenge_participants (
  id SERIAL PRIMARY KEY,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  -- 'active', 'completed', 'quit'
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  total_km NUMERIC NOT NULL DEFAULT 0,
  total_runs INTEGER NOT NULL DEFAULT 0,
  last_activity_date DATE,
  UNIQUE(challenge_id, user_id)
);

-- Streak history: daily log of streak activity per participant
CREATE TABLE IF NOT EXISTS streak_log (
  id SERIAL PRIMARY KEY,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  km NUMERIC NOT NULL DEFAULT 0,
  runs_count INTEGER NOT NULL DEFAULT 1,
  run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(challenge_id, user_id, log_date)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_challenges_creator ON challenges(creator_id);
CREATE INDEX IF NOT EXISTS idx_challenges_invite ON challenges(invite_code);
CREATE INDEX IF NOT EXISTS idx_challenge_participants_user ON challenge_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_challenge_participants_challenge ON challenge_participants(challenge_id);
CREATE INDEX IF NOT EXISTS idx_streak_log_user_date ON streak_log(user_id, log_date);
