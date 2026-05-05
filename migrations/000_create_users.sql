-- Genereret fra production-skema for at give staging samme users-tabel
-- Dette skal IKKE køres mod production (den har allerede tabellen)

CREATE TABLE IF NOT EXISTS users (
  id SERIAL NOT NULL,
  email text NOT NULL,
  password text NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  subscription_tier text DEFAULT 'free'::text,
  subscription_status text,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_ends_at TIMESTAMP,
  apple_original_transaction_id VARCHAR(255),
  revenuecat_id VARCHAR(255),
  PRIMARY KEY (id)
);