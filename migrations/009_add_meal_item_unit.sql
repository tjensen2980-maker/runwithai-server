-- Migration 009: Add amount + unit to meal_items
-- Idempotent: bruger ADD COLUMN IF NOT EXISTS
-- Bevarer amount_g som primary (kanonisk gram-værdi); amount + unit er info om brugerens valg.

ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS amount NUMERIC;
ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS unit TEXT;
