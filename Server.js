const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();

app.use(cors());
app.use(express.json());

const API_KEY = process.env.ANTHROPIC_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'runwithai-secret-2026';

// ─── DATABASE SETUP ───────────────────────────────────────────────────────────
let db;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  db = {
    query: (text, params) => pool.query(text, params),
    type: 'pg',
  };
  pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      user_id INTEGER REFERENCES users(id),
      data TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS week_plan (
      id INTEGER PRIMARY KEY DEFAULT 1,
      user_id INTEGER REFERENCES users(id),
      data TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `).then(() => console.log('Database klar ✓')).catch(e => console.error('DB setup fejl:', e));
} else {
  const Database = require('better-sqlite3');
  const sqliteDb = new Database('runwithai.db');
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      user_id INTEGER,
      data TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS week_plan (
      id INTEGER PRIMARY KEY DEFAULT 1,
      user_id INTEGER,
      data TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db = {
    query: async (text, params = []) => {
      const isPg = false;
      // Convert $1,$2 to ? for sqlite
      let sqliteText = text.replace(/\$\d+/g, '?');
      if (sqliteText.trim().toUpperCase().startsWith('SELECT') ||
          sqliteText.trim().toUpperCase().startsWith('WITH')) {
        const rows = sqliteDb.prepare(sqliteText).all(...params);
        return { rows };
      } else if (sqliteText.trim().toUpperCase().includes('RETURNING')) {
        sqliteText = sqliteText.replace(/RETURNING.*/i, '');
        const stmt = sqliteDb.prepare(sqliteText.trim());
        const info = stmt.run(...params);
        const table = sqliteText.match(/INTO (\w+)/i)?.[1] || sqliteText.match(/UPDATE (\w+)/i)?.[1];
        const row = table ? sqliteDb.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid) : {};
        return { rows: [row] };
      } else {
        const info = sqliteDb.prepare(sqliteText).run(...params);
        return { rows: [], rowCount: info.changes };
      }
    },
    type: 'sqlite',
  };
  console.log('Database klar ✓');
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Ikke logget ind' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token ugyldig' });
  }
}

// ─── AUTH ENDPOINTS ───────────────────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email og adgangskode kræves' });
  if (password.length < 6) return res.status(400).json({ error: 'Adgangskode skal være mindst 6 tegn' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email.toLowerCase().trim(), hashed]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    if (e.message?.includes('UNIQUE') || e.code === '23505') {
      res.status(400).json({ error: 'Email er allerede i brug' });
    } else {
      console.error('Register fejl:', e);
      res.status(500).json({ error: 'Serverfejl' });
    }
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email og adgangskode kræves' });
  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Forkert email eller adgangskode' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Forkert email eller adgangskode' });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error('Login fejl:', e);
    res.status(500).json({ error: 'Serverfejl' });
  }
});

// ─── PROFILE ──────────────────────────────────────────────────────────────────
app.get('/profile', authMiddleware, async (req, res) => {
  try {
    const result = await db.query('SELECT data FROM profile WHERE user_id = $1', [req.user.id]);
    const row = result.rows[0];
    res.json(row?.data ? JSON.parse(row.data) : {});
  } catch (e) { res.json({}); }
});

app.post('/profile', authMiddleware, async (req, res) => {
  try {
    await db.query(
      `INSERT INTO profile (id, user_id, data, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $3, user_id = $2, updated_at = NOW()`,
      [req.user.id, req.user.id, JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Fejl' }); }
});

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
app.get('/messages', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT role, text FROM messages WHERE user_id = $1 ORDER BY created_at ASC LIMIT 100',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) { res.json([]); }
});

app.delete('/messages', authMiddleware, async (req, res) => {
  try {
    await db.query('DELETE FROM messages WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Fejl' }); }
});

// ─── WEEK PLAN ────────────────────────────────────────────────────────────────
app.get('/weekplan', authMiddleware, async (req, res) => {
  try {
    const result = await db.query('SELECT data FROM week_plan WHERE user_id = $1', [req.user.id]);
    const row = result.rows[0];
    res.json(row?.data ? JSON.parse(row.data) : null);
  } catch (e) { res.json(null); }
});

app.post('/weekplan', authMiddleware, async (req, res) => {
  try {
    await db.query(
      `INSERT INTO week_plan (id, user_id, data, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $3, user_id = $2, updated_at = NOW()`,
      [req.user.id, req.user.id, JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Fejl' }); }
});

// ─── CHAT ─────────────────────────────────────────────────────────────────────
app.post('/chat', authMiddleware, async (req, res) => {
  try {
    const { messages, system, model, max_tokens } = req.body;
    // Gem brugerens besked
    const userMsg = messages?.[messages.length - 1];
    if (userMsg?.role === 'user') {
      await db.query('INSERT INTO messages (user_id, role, text) VALUES ($1, $2, $3)',
        [req.user.id, 'user', userMsg.content]);
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-sonnet-4-20250514', max_tokens: max_tokens || 1000, system, messages }),
    });
    const data = await response.json();
    // Gem AI svar
    const aiText = data.content?.[0]?.text;
    if (aiText) {
      await db.query('INSERT INTO messages (user_id, role, text) VALUES ($1, $2, $3)',
        [req.user.id, 'assistant', aiText]);
    }
    res.json(data);
  } catch (e) {
    console.error('Chat fejl:', e);
    res.status(500).json({ type: 'error', error: { message: 'Serverfejl' } });
  }
});

// ─── STATUS ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'RunWithAI server kører!' }));

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => console.log(`RunWithAI server kører på port ${PORT} ✓`));
