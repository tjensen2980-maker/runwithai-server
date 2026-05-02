CREATE TABLE IF NOT EXISTS foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  source_id TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  serving_size_g NUMERIC,
  kcal_per_100g NUMERIC NOT NULL,
  protein_g NUMERIC NOT NULL DEFAULT 0,
  carbs_g NUMERIC NOT NULL DEFAULT 0,
  fat_g NUMERIC NOT NULL DEFAULT 0,
  fiber_g NUMERIC,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_foods_name ON foods(LOWER(name));

CREATE TABLE IF NOT EXISTS meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  eaten_at TIMESTAMPTZ NOT NULL,
  meal_type TEXT CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  notes TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meals_user_eaten ON meals(user_id, eaten_at DESC);

CREATE TABLE IF NOT EXISTS meal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  food_id UUID REFERENCES foods(id) ON DELETE SET NULL,
  amount_g NUMERIC NOT NULL,
  -- snapshot — så ændringer i foods ikke ændrer historik
  kcal NUMERIC NOT NULL,
  protein_g NUMERIC NOT NULL DEFAULT 0,
  carbs_g NUMERIC NOT NULL DEFAULT 0,
  fat_g NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_meal_items_meal ON meal_items(meal_id);