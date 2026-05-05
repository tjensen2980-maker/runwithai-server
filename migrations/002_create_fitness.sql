CREATE TABLE IF NOT EXISTS exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  muscle_groups TEXT[] NOT NULL DEFAULT '{}',
  equipment TEXT,
  category TEXT,
  video_url TEXT,
  is_custom BOOLEAN NOT NULL DEFAULT false,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises(LOWER(name));

CREATE TABLE IF NOT EXISTS workout_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  generated_by_ai BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workout_template_exercises (
  template_id UUID NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
  position INT NOT NULL,
  exercise_id UUID NOT NULL REFERENCES exercises(id),
  target_sets INT,
  target_reps TEXT,
  target_rpe NUMERIC,
  rest_sec INT,
  PRIMARY KEY (template_id, position)
);

CREATE TABLE IF NOT EXISTS strength_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id),
  set_number INT NOT NULL,
  reps INT,
  weight_kg NUMERIC,
  rpe NUMERIC,
  is_warmup BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strength_sets_activity ON strength_sets(activity_id);
CREATE INDEX IF NOT EXISTS idx_strength_sets_exercise ON strength_sets(exercise_id);