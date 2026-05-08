-- Cykel-specifikke felter (1:1 med activities hvor type='bike')
CREATE TABLE IF NOT EXISTS activity_bike_details (
  activity_id UUID PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  distance_m INT,
  avg_speed_kmh NUMERIC(5,2),
  max_speed_kmh NUMERIC(5,2),
  total_ascent_m NUMERIC,
  total_descent_m NUMERIC,
  splits JSONB,
  hr_samples JSONB,
  gps_polyline TEXT
);
