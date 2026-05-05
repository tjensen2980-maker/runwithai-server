require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function seed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set in .env');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected to database');

  const file = path.join(__dirname, '..', 'seeds', 'exercises.json');
  const exercises = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('Loaded ' + exercises.length + ' exercises from JSON');

  // Tilføj UNIQUE-constraint på name første gang vi seeder, så ON CONFLICT virker.
  // Dette er idempotent (gør ingenting hvis constraint allerede findes).
  await client.query(
    "DO $$ BEGIN " +
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercises_name_unique') THEN " +
    "    ALTER TABLE exercises ADD CONSTRAINT exercises_name_unique UNIQUE (name); " +
    "  END IF; " +
    "END $$;"
  );

  let inserted = 0;
  let skipped = 0;

  for (const ex of exercises) {
    const result = await client.query(
      'INSERT INTO exercises (name, muscle_groups, equipment, category, is_custom) ' +
      'VALUES ($1, $2, $3, $4, false) ' +
      'ON CONFLICT (name) DO NOTHING ' +
      'RETURNING id',
      [ex.name, ex.muscle_groups, ex.equipment, ex.category]
    );
    if (result.rowCount > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  console.log('Inserted: ' + inserted);
  console.log('Skipped (already exists): ' + skipped);

  // Tjek samlet antal
  const count = await client.query('SELECT COUNT(*) FROM exercises');
  console.log('Total exercises in database: ' + count.rows[0].count);

  await client.end();
  console.log('Done');
}

seed().catch(function(err) {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});