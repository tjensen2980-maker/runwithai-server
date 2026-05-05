require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set');
    process.exit(1);
  }

  console.log('DATABASE_URL length:', connectionString.length);
  console.log('First 30 chars:', JSON.stringify(connectionString.substring(0, 30)));
  console.log('Last 40 chars:', JSON.stringify(connectionString.substring(connectionString.length - 40)));

  try {
    const url = new URL(connectionString);
    console.log('Parsed host:', url.hostname);
    console.log('Parsed port:', url.port);
    console.log('Parsed user:', url.username);
    console.log('Parsed db:', url.pathname);
  } catch (e) {
    console.log('URL parse failed:', e.message);
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected to database');

  await client.query('CREATE TABLE IF NOT EXISTS _migrations (id SERIAL PRIMARY KEY, filename TEXT UNIQUE NOT NULL, applied_at TIMESTAMPTZ DEFAULT NOW())');

  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(function(f) { return f.endsWith('.sql'); }).sort();
  console.log('Found ' + files.length + ' migration file(s)');

  const result = await client.query('SELECT filename FROM _migrations');
  const appliedSet = new Set(result.rows.map(function(r) { return r.filename; }));

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log('SKIP  ' + file + ' (already applied)');
      continue;
    }
    console.log('APPLY ' + file);
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('  OK ' + file);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('  FAIL ' + file + ':', err.message);
      process.exit(1);
    }
  }

  await client.end();
  console.log('Done');
}

run().catch(function(err) {
  console.error('UNHANDLED ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});