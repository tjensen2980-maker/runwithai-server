const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const app = express();

app.use(cors());
app.use(express.json());

const API_KEY = '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'; // ← din Anthropic nøgle

// ─── DATABASE SETUP ───────────────────────────────────────────────────────────
const db = new Database('runwithai.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY DEFAULT 1,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS week_plan (
    id INTEGER PRIMARY KEY DEFAULT 1,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
console.log('Database klar ✓');

// ─── PROFIL ───────────────────────────────────────────────────────────────────
app.get('/profile', (req, res) => {
  const row = db.prepare('SELECT data FROM profile WHERE id = 1').get();
  res.json(row ? JSON.parse(row.data) : {});
});

app.post('/profile', (req, res) => {
  const data = JSON.stringify(req.body);
  db.prepare(`INSERT INTO profile (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=?, updated_at=CURRENT_TIMESTAMP`).run(data, data);
  res.json({ ok: true });
});

// ─── SAMTALEHISTORIK ──────────────────────────────────────────────────────────
app.get('/messages', (req, res) => {
  const rows = db.prepare('SELECT role, text FROM messages ORDER BY id DESC LIMIT 50').all();
  res.json(rows.reverse());
});

app.delete('/messages', (req, res) => {
  db.prepare('DELETE FROM messages').run();
  res.json({ ok: true });
});

// ─── UGEPLAN ──────────────────────────────────────────────────────────────────
app.get('/weekplan', (req, res) => {
  const row = db.prepare('SELECT data FROM week_plan WHERE id = 1').get();
  res.json(row ? JSON.parse(row.data) : null);
});

app.post('/weekplan', (req, res) => {
  const data = JSON.stringify(req.body);
  db.prepare(`INSERT INTO week_plan (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=?, updated_at=CURRENT_TIMESTAMP`).run(data, data);
  res.json({ ok: true });
});

// ─── AI CHAT ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'RunWithAI server kører!' }));

app.post('/chat', async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'user') {
      db.prepare('INSERT INTO messages (role, text) VALUES (?, ?)').run('user', lastMsg.content || '');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    const aiText = data.content?.[0]?.text || '';
    if (aiText) {
      db.prepare('INSERT INTO messages (role, text) VALUES (?, ?)').run('assistant', aiText);
    }

    console.log('Chat OK ✓');
    res.json(data);
  } catch (err) {
    console.error('FEJL:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3333, '0.0.0.0', () => console.log('RunWithAI server kører på port 3333 ✓'));