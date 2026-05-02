require('dotenv').config();
const { Client } = require('pg');

// SIKKERHED: Dette script må KUN læse fra production. Aldrig skrive.
// Hvis du ser nogen INSERT/UPDATE/DELETE/DROP/ALTER her - stop og spørg.

async function extractSchema() {
  const prodUrl = process.env.PRODUCTION_DATABASE_URL;
  if (!prodUrl) {
    console.error('PRODUCTION_DATABASE_URL not set in .env');
    process.exit(1);
  }

  const client = new Client({
    connectionString: prodUrl,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('-- Connected to PRODUCTION (read-only)');
  console.log('-- Extracting schema for users table\n');

  // Hent kolonner
  const cols = await client.query(
    "SELECT column_name, data_type, udt_name, character_maximum_length, " +
    "is_nullable, column_default " +
    "FROM information_schema.columns " +
    "WHERE table_schema = 'public' AND table_name = $1 " +
    "ORDER BY ordinal_position",
    ['users']
  );

  if (cols.rows.length === 0) {
    console.error('No users table found in production!');
    await client.end();
    process.exit(1);
  }

  // Hent primary key
  const pk = await client.query(
    "SELECT a.attname AS column_name " +
    "FROM pg_index i " +
    "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) " +
    "WHERE i.indrelid = 'public.users'::regclass AND i.indisprimary"
  );

  // Byg CREATE TABLE statement
  let sql = '-- Genereret fra production-skema\n';
  sql += 'CREATE TABLE IF NOT EXISTS users (\n';

  const colDefs = cols.rows.map(function(c) {
    let type = c.data_type;
    if (type === 'character varying') {
      type = c.character_maximum_length ? 'VARCHAR(' + c.character_maximum_length + ')' : 'VARCHAR';
    } else if (type === 'integer') {
      // Tjek om det er auto-increment via default
      if (c.column_default && c.column_default.indexOf('nextval') !== -1) {
        type = 'SERIAL';
      } else {
        type = 'INTEGER';
      }
    } else if (type === 'timestamp without time zone') {
      type = 'TIMESTAMP';
    } else if (type === 'timestamp with time zone') {
      type = 'TIMESTAMPTZ';
    }
    let def = '  ' + c.column_name + ' ' + type;
    if (c.is_nullable === 'NO') def += ' NOT NULL';
    if (c.column_default && c.column_default.indexOf('nextval') === -1) {
      def += ' DEFAULT ' + c.column_default;
    }
    return def;
  });

  if (pk.rows.length > 0) {
    const pkCols = pk.rows.map(function(r) { return r.column_name; }).join(', ');
    colDefs.push('  PRIMARY KEY (' + pkCols + ')');
  }

  sql += colDefs.join(',\n');
  sql += '\n);\n';

  console.log(sql);
  await client.end();
}

extractSchema().catch(function(err) {
  console.error('ERROR:', err.message);
  process.exit(1);
});