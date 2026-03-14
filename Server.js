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
    CREATE TABLE IF NOT EXISTS shared_runs (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      run_id INTEGER,
      name TEXT,
      km REAL,
      duration_secs INTEGER,
      pace_secs_per_km REAL,
      avg_hr INTEGER,
      ai_comment TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS friends (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      friend_id INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, friend_id)
    );
    CREATE TABLE IF NOT EXISTS kudos (
      id SERIAL PRIMARY KEY,
      run_share_id TEXT REFERENCES shared_runs(id),
      from_user_id INTEGER REFERENCES users(id),
      emoji TEXT DEFAULT '🔥',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(run_share_id, from_user_id)
    );
    CREATE TABLE IF NOT EXISTS badges (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      badge_id TEXT NOT NULL,
      earned_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, badge_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      run_share_id TEXT REFERENCES shared_runs(id),
      user_id INTEGER REFERENCES users(id),
      comment TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS integrations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) UNIQUE,
      garmin_token TEXT,
      garmin_refresh_token TEXT,
      apple_health_enabled BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `).then(() => {
  console.log('Database klar ✓');
  // Migrer runs tabel med nye kolonner
  db.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS splits TEXT').catch(() => {});
  db.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS shoe_id TEXT').catch(() => {});
  db.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS route TEXT').catch(() => {});
  db.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS notes TEXT').catch(() => {});
  db.query('ALTER TABLE runs ADD COLUMN IF NOT EXISTS date TIMESTAMP DEFAULT NOW()').catch(() => {});
}).catch(e => console.error('DB setup fejl:', e));
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
// FIX: Hent de nyeste 200 beskeder (ikke kun de første 100)
app.get('/messages', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT role, text FROM (
        SELECT role, text, created_at FROM messages 
        WHERE user_id = $1 
        ORDER BY created_at DESC LIMIT 200
      ) sub ORDER BY created_at ASC`,
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


// ─── RUNS ─────────────────────────────────────────────────────────────────────
app.get('/runs', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM runs WHERE user_id = $1 ORDER BY date DESC LIMIT 50',
      [req.user.id]
    );
    const runs = result.rows.map(r => {
      let notes = r.notes;
      let diary = null;
      try {
        const parsed = typeof notes === 'string' ? JSON.parse(notes) : notes;
        if (parsed && parsed.diary) { diary = parsed.diary; }
      } catch {}
      return { ...r, diary };
    });
    res.json(runs);
  } catch (e) { res.json([]); }
});

app.post('/runs', authMiddleware, async (req, res) => {
  try {
    const { km, duration_secs, pace_secs_per_km, avg_hr, route, notes, splits, shoe_id } = req.body;
    const result = await db.query(
      'INSERT INTO runs (user_id, km, duration_secs, pace_secs_per_km, avg_hr, route, notes, splits, shoe_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.user.id, km, duration_secs, pace_secs_per_km, avg_hr || null, route ? JSON.stringify(route) : null, notes || null, splits ? JSON.stringify(splits) : null, shoe_id || null]
    );
    res.json(result.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Fejl' }); }
});

app.delete('/runs/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM runs WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Løb ikke fundet' });
    res.json({ deleted: true, id: req.params.id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Fejl' }); }
});

// ─── PATCH RUN (dagbog/noter) ─────────────────────────────────────────────────
app.patch('/runs/:id', authMiddleware, async (req, res) => {
  try {
    const { diary } = req.body;
    const result = await db.query(
      `UPDATE runs SET notes = COALESCE(notes::jsonb || $1::jsonb, $1::jsonb)
       WHERE id = $2 AND user_id = $3 RETURNING id`,
      [JSON.stringify({ diary }), req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Løb ikke fundet' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Fejl' }); }
});



// ─── TRAINING PLAN ────────────────────────────────────────────────────────────
app.get('/trainingplan', authMiddleware, async (req, res) => {
  try {
    const result = await db.query('SELECT data, generated_at FROM training_plan WHERE user_id = $1', [req.user.id]);
    res.json(result.rows[0] ? { data: JSON.parse(result.rows[0].data), generated_at: result.rows[0].generated_at } : null);
  } catch { res.json(null); }
});

app.post('/trainingplan/generate', authMiddleware, async (req, res) => {
  try {
    const { profile, level, recentRuns } = req.body;
    const runSummary = recentRuns?.slice(0,5).map(r => {
      const mins = Math.floor(r.duration_secs/60);
      const pace = r.pace_secs_per_km ? `${Math.floor(r.pace_secs_per_km/60)}:${String(Math.round(r.pace_secs_per_km%60)).padStart(2,'0')}/km` : '?';
      return `${r.km?.toFixed(1)}km på ${mins}min (${pace})`;
    }).join(', ') || 'ingen tidligere løb';

    const prompt = `Du er en professionel løbecoach. Lav en ugentlig træningsplan for denne løber:
Profil: ${profile?.name || 'Løber'}, ${profile?.age || '?'} år, niveau: ${level}
Ugekilometer mål: ${profile?.weeklyKm || '?'} km, År med løb: ${profile?.yearsRunning || '?'}
Mål: ${profile?.goal || 'generel fitness'}
Seneste løb: ${runSummary}

Lav en 7-dages plan. Svar KUN med JSON i dette format, ingen tekst før eller efter:
[
  {"day":"Man","workout":"navn","km":8,"color":"#c8ff00","type":"run","description":"kort beskrivelse"},
  {"day":"Tir","workout":"Hvile","km":0,"color":"#2a2a2f","type":"rest","description":"aktiv restitution"},
  ...alle 7 dage...
]
Type kan være: run, rest, cross. Colors: #c8ff00 (interval), #2ecc71 (roligt), #ff6b35 (tempo), #3a7bd5 (langtur), #a855f7 (styrke), #2a2a2f (hvile).`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    });
    const aiData = await response.json();
    const text = aiData.content?.[0]?.text || '[]';
    let plan;
    try { plan = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch { plan = []; }

    await db.query(
      'INSERT INTO training_plan (user_id, data, generated_at) VALUES ($1,$2,NOW()) ON CONFLICT (user_id) DO UPDATE SET data=$2, generated_at=NOW()',
      [req.user.id, JSON.stringify(plan)]
    );
    res.json({ data: plan, generated_at: new Date() });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Fejl ved generering' }); }
});

// Gem AI coach planændring som træningsplan
app.post('/trainingplan/save', authMiddleware, async (req, res) => {
  try {
    const { data } = req.body;
    await db.query(
      'INSERT INTO training_plan (user_id, data, generated_at) VALUES ($1,$2,NOW()) ON CONFLICT (user_id) DO UPDATE SET data=$2, generated_at=NOW()',
      [req.user.id, JSON.stringify(data)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Fejl' }); }
});

// ─── STATUS ───────────────────────────────────────────────────────────────────
// ─── RACE PREDICTOR ──────────────────────────────────────────────────────────
app.post('/predict', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: message }],
      }),
    });
    const data = await response.json();
    const reply = data.content?.[0]?.text || '';
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ─── RUTE FORSLAG ────────────────────────────────────────────────────────────
app.post('/routes/suggest', authMiddleware, async (req, res) => {
  try {
    const { lat, lon, km = 5, type = 'loop', areaName = '', recentPace = '', savedRoutes = [] } = req.body;

    // Byg præference-kontekst fra gemte ruter med stjerner
    const ratedRoutes = (savedRoutes || []).filter(r => r.stars > 0);
    const prefContext = ratedRoutes.length > 0
      ? `\n\nUser's rated routes (learn preferences):\n${ratedRoutes.map(r =>
          `- "${r.name}" ${r.stars}/5 stars: ${r.terrain}, ${r.difficulty}${r.note ? `, note: "${r.note}"` : ''}`
        ).join('\n')}\nUse these to suggest routes that match their preferences.`
      : '';

    const prompt = `You are a running route planner. The user is near ${areaName || 'Denmark'} at coordinates (${lat}, ${lon}).

Generate exactly 3 running route suggestions of approximately ${km} km as ${type === 'loop' ? 'loop routes' : 'out-and-back routes'}.

CRITICAL: Respond with ONLY a valid JSON array. No markdown, no backticks, no explanation. Start with [ and end with ].

Use real street names, parks, lakes, or landmarks near (${lat}, ${lon}). Generate realistic GPS waypoints that form a logical running path.${prefContext}

[
  {
    "name": "Route name in Danish",
    "km": ${km},
    "type": "${type}",
    "terrain": "asfalt",
    "difficulty": "let",
    "highlight": "What makes this route special in Danish (max 10 words)",
    "waypoints": [
      {"lat": ${lat}, "lon": ${lon}, "name": "Start"},
      {"lat": REAL_LAT, "lon": REAL_LON, "name": "Real landmark name"},
      {"lat": REAL_LAT, "lon": REAL_LON, "name": "Real landmark name"},
      {"lat": ${lat}, "lon": ${lon}, "name": "Finish"}
    ]
  },
  {
    "name": "Route name 2",
    "km": ${km},
    "type": "${type}",
    "terrain": "sti",
    "difficulty": "moderat",
    "highlight": "Description in Danish",
    "waypoints": [...]
  },
  {
    "name": "Route name 3",
    "km": ${km},
    "type": "${type}",
    "terrain": "blandet",
    "difficulty": "hård",
    "highlight": "Description in Danish",
    "waypoints": [...]
  }
]

User pace: ${recentPace || 'unknown'}. Make waypoints geographically accurate for the area.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    let text = data.content?.[0]?.text || '';

    // Strip markdown fences if present
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    // Extract JSON array
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return res.status(422).json({ error: 'AI returned unexpected format', raw: text.slice(0, 200) });
    }

    let routes;
    try {
      routes = JSON.parse(match[0]);
    } catch (parseErr) {
      // Try to fix common JSON issues (trailing commas)
      const cleaned = match[0].replace(/,\s*([}\]])/g, '$1');
      routes = JSON.parse(cleaned);
    }

    // Ensure waypoints have lat/lon numbers (not strings)
    routes = routes.map(r => ({
      ...r,
      id: Math.random().toString(36).slice(2),
      waypoints: (r.waypoints || []).map(w => ({
        ...w,
        lat: parseFloat(w.lat),
        lon: parseFloat(w.lon),
      })),
      points: (r.waypoints || []).map(w => ({ lat: parseFloat(w.lat), lon: parseFloat(w.lon) })),
    }));

    res.json({ routes });
  } catch (e) {
    console.error('Route suggest error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── SOCIALE FEATURES ────────────────────────────────────────────────────────

// Del et løb — generér et unikt share-id og gem det
app.post('/runs/share', authMiddleware, async (req, res) => {
  const { run_id, km, duration_secs, pace_secs_per_km, avg_hr, ai_comment } = req.body;
  const shareId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const profile = await db.query('SELECT data FROM profile WHERE user_id = $1', [req.user.id]);
  const name = profile.rows[0] ? JSON.parse(profile.rows[0].data || '{}').name || 'Løber' : 'Løber';
  try {
    await db.query(
      'INSERT INTO shared_runs (id, user_id, run_id, name, km, duration_secs, pace_secs_per_km, avg_hr, ai_comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING',
      [shareId, req.user.id, run_id || null, name, km, duration_secs, pace_secs_per_km, avg_hr || null, ai_comment || null]
    );
    res.json({ shareId, url: `/shared/${shareId}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Hent et delt løb — offentligt, ingen auth
app.get('/shared/:id', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM shared_runs WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
  const kudosRes = await db.query('SELECT emoji, COUNT(*) as count FROM kudos WHERE run_share_id = $1 GROUP BY emoji', [req.params.id]);
  res.json({ run: rows[0], kudos: kudosRes.rows });
});

// Giv kudos på et delt løb
app.post('/shared/:id/kudos', authMiddleware, async (req, res) => {
  const { emoji } = req.body;
  try {
    await db.query(
      'INSERT INTO kudos (run_share_id, from_user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT (run_share_id, from_user_id) DO UPDATE SET emoji = $3',
      [req.params.id, req.user.id, emoji || '🔥']
    );
    const kudosRes = await db.query('SELECT emoji, COUNT(*) as count FROM kudos WHERE run_share_id = $1 GROUP BY emoji', [req.params.id]);
    res.json({ kudos: kudosRes.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send venneanmodning
app.post('/friends/request', authMiddleware, async (req, res) => {
  const { email } = req.body;
  const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!rows[0]) return res.status(404).json({ error: 'Bruger ikke fundet' });
  if (rows[0].id === req.user.id) return res.status(400).json({ error: 'Kan ikke tilføje dig selv' });
  try {
    await db.query(
      'INSERT INTO friends (user_id, friend_id, status) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.user.id, rows[0].id, 'pending']
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Accepter/afvis venneanmodning
app.post('/friends/:id/respond', authMiddleware, async (req, res) => {
  const { accept } = req.body;
  if (accept) {
    await db.query('UPDATE friends SET status = $1 WHERE user_id = $2 AND friend_id = $3', ['accepted', req.params.id, req.user.id]);
    // Tilføj begge veje
    await db.query('INSERT INTO friends (user_id, friend_id, status) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.user.id, req.params.id, 'accepted']);
  } else {
    await db.query('DELETE FROM friends WHERE user_id = $1 AND friend_id = $2', [req.params.id, req.user.id]);
  }
  res.json({ ok: true });
});

// Hent venner og pending requests
app.get('/friends', authMiddleware, async (req, res) => {
  const friends = await db.query(`
    SELECT u.id, u.email, p.data as profile_data, f.status
    FROM friends f
    JOIN users u ON u.id = f.friend_id
    LEFT JOIN profile p ON p.user_id = u.id
    WHERE f.user_id = $1
    ORDER BY f.status, f.created_at DESC
  `, [req.user.id]);

  const pending = await db.query(`
    SELECT u.id, u.email, p.data as profile_data
    FROM friends f
    JOIN users u ON u.id = f.user_id
    LEFT JOIN profile p ON p.user_id = u.id
    WHERE f.friend_id = $1 AND f.status = 'pending'
  `, [req.user.id]);

  res.json({ friends: friends.rows, pending: pending.rows });
});

// Hent venners seneste løb (feed)
app.get('/friends/feed', authMiddleware, async (req, res) => {
  const { rows } = await db.query(`
    SELECT sr.*, 
           (SELECT COUNT(*) FROM kudos k WHERE k.run_share_id = sr.id) as kudos_count
    FROM shared_runs sr
    WHERE sr.user_id IN (
      SELECT friend_id FROM friends WHERE user_id = $1 AND status = 'accepted'
    )
    ORDER BY sr.created_at DESC
    LIMIT 20
  `, [req.user.id]);
  res.json({ feed: rows });
});

app.get('/', (req, res) => res.json({ status: 'RunWithAI server kører!' }));

// ─── NOMINATIM PROXY ──────────────────────────────────────────────────────────
app.get('/nominatim', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || q.length < 3) return res.json([]);
    // Photon API - gratis, ingen rate-limit, OSM-baseret
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=de&bbox=8.0,54.5,15.5,57.8`;
    const r = await fetch(url, { headers: { 'User-Agent': 'RunWithAI/1.0 (kontakt@runwithai.app)' } });
    const geojson = await r.json();
    // Konverter GeoJSON til Nominatim-kompatibelt format
    const data = (geojson.features || []).map(f => ({
      display_name: [f.properties.name, f.properties.street, f.properties.city, f.properties.country].filter(Boolean).join(', '),
      lat: String(f.geometry.coordinates[1]),
      lon: String(f.geometry.coordinates[0]),
    }));
    res.json(data);
  } catch (e) {
    res.json([]);
  }
});

// ─── RUTE-ROUTER: GraphHopper foot proxy ─────────────────────────────────────
app.post('/routes/ors', async (req, res) => {
  try {
    const { coordinates } = req.body;
    // Byg GraphHopper URL med waypoints
    const points = coordinates.map(c => `point=${c[1]},${c[0]}`).join('&');
    const url = `https://graphhopper.com/api/1/route?${points}&vehicle=foot&locale=da&key=LijBPDQGfu7Iiq80w3HzwB4RUDJbMbhs6BU0dEnn`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── OPENAI TTS ──────────────────────────────────────────────────────────────
app.post('/tts', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Ingen tekst' });

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text.slice(0, 500), // max 500 tegn pr. kald
        voice: 'nova', // lyder naturlig og venlig
        response_format: 'mp3',
        speed: 1.0,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: err });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── BADGES & ACHIEVEMENTS ────────────────────────────────────────────────────
const BADGE_DEFINITIONS = {
  first_run: { check: (runs) => runs.length >= 1 },
  km_10: { check: (runs) => runs.reduce((s, r) => s + (r.km || 0), 0) >= 10 },
  km_50: { check: (runs) => runs.reduce((s, r) => s + (r.km || 0), 0) >= 50 },
  km_100: { check: (runs) => runs.reduce((s, r) => s + (r.km || 0), 0) >= 100 },
  km_500: { check: (runs) => runs.reduce((s, r) => s + (r.km || 0), 0) >= 500 },
  km_1000: { check: (runs) => runs.reduce((s, r) => s + (r.km || 0), 0) >= 1000 },
  run_5k: { check: (runs) => runs.some(r => r.km >= 5) },
  run_10k: { check: (runs) => runs.some(r => r.km >= 10) },
  run_half: { check: (runs) => runs.some(r => r.km >= 21) },
  run_marathon: { check: (runs) => runs.some(r => r.km >= 42) },
  pace_sub6: { check: (runs) => runs.some(r => r.pace_secs_per_km && r.pace_secs_per_km < 360) },
  pace_sub5: { check: (runs) => runs.some(r => r.pace_secs_per_km && r.pace_secs_per_km < 300) },
  pace_sub4: { check: (runs) => runs.some(r => r.pace_secs_per_km && r.pace_secs_per_km < 240) },
};

app.get('/badges', authMiddleware, async (req, res) => {
  try {
    const result = await db.query('SELECT badge_id, earned_at FROM badges WHERE user_id = $1', [req.user.id]);
    const earned = result.rows.map(r => ({ id: r.badge_id, earnedAt: r.earned_at }));
    res.json({ earned });
  } catch (e) {
    res.json({ earned: [] });
  }
});

app.post('/badges/check', authMiddleware, async (req, res) => {
  try {
    const { runs } = req.body;
    if (!runs) return res.json({ newBadges: [] });
    
    // Hent allerede optjente badges
    const existing = await db.query('SELECT badge_id FROM badges WHERE user_id = $1', [req.user.id]);
    const existingIds = new Set(existing.rows.map(r => r.badge_id));
    
    const newBadges = [];
    
    for (const [badgeId, def] of Object.entries(BADGE_DEFINITIONS)) {
      if (!existingIds.has(badgeId) && def.check(runs)) {
        await db.query(
          'INSERT INTO badges (user_id, badge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.user.id, badgeId]
        );
        newBadges.push(badgeId);
      }
    }
    
    res.json({ newBadges });
  } catch (e) {
    res.json({ newBadges: [], error: e.message });
  }
});

// ─── STREAK ───────────────────────────────────────────────────────────────────
app.get('/streak', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT date FROM runs WHERE user_id = $1 ORDER BY date DESC',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.json({ currentStreak: 0, longestStreak: 0, lastRunDate: null });
    }
    
    // Beregn streak
    const dates = [...new Set(result.rows.map(r => {
      const d = new Date(r.date);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }))].sort().reverse();
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    
    let currentStreak = 0;
    if (dates[0] === todayStr || dates[0] === yesterdayStr) {
      currentStreak = 1;
      let checkDate = new Date(dates[0]);
      for (let i = 1; i < dates.length; i++) {
        checkDate.setDate(checkDate.getDate() - 1);
        const checkStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth()+1).padStart(2,'0')}-${String(checkDate.getDate()).padStart(2,'0')}`;
        if (dates[i] === checkStr) currentStreak++;
        else break;
      }
    }
    
    // Find længste streak
    let longestStreak = currentStreak;
    let tempStreak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prevDate = new Date(dates[i-1]);
      const currDate = new Date(dates[i]);
      const diffDays = Math.round((prevDate - currDate) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) tempStreak++;
      else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, tempStreak);
    
    res.json({ 
      currentStreak, 
      longestStreak, 
      lastRunDate: dates[0],
      ranToday: dates[0] === todayStr
    });
  } catch (e) {
    res.json({ currentStreak: 0, longestStreak: 0, error: e.message });
  }
});

// ─── COMMENTS ─────────────────────────────────────────────────────────────────
app.post('/shared/:id/comment', authMiddleware, async (req, res) => {
  try {
    const { comment } = req.body;
    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({ error: 'Kommentar påkrævet' });
    }
    
    await db.query(
      'INSERT INTO comments (run_share_id, user_id, comment) VALUES ($1, $2, $3)',
      [req.params.id, req.user.id, comment.trim()]
    );
    
    // Hent alle kommentarer
    const result = await db.query(`
      SELECT c.*, u.email, p.data as profile_data
      FROM comments c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN profile p ON p.user_id = u.id
      WHERE c.run_share_id = $1
      ORDER BY c.created_at ASC
    `, [req.params.id]);
    
    const comments = result.rows.map(r => ({
      id: r.id,
      comment: r.comment,
      createdAt: r.created_at,
      user: {
        email: r.email,
        name: r.profile_data ? JSON.parse(r.profile_data).name : r.email.split('@')[0],
      }
    }));
    
    res.json({ comments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/shared/:id/comments', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.*, u.email, p.data as profile_data
      FROM comments c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN profile p ON p.user_id = u.id
      WHERE c.run_share_id = $1
      ORDER BY c.created_at ASC
    `, [req.params.id]);
    
    const comments = result.rows.map(r => ({
      id: r.id,
      comment: r.comment,
      createdAt: r.created_at,
      user: {
        email: r.email,
        name: r.profile_data ? JSON.parse(r.profile_data).name : r.email.split('@')[0],
      }
    }));
    
    res.json({ comments });
  } catch (e) {
    res.json({ comments: [] });
  }
});

// ─── ENHANCED SOCIAL FEED ─────────────────────────────────────────────────────
app.get('/feed', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        sr.*,
        (SELECT COUNT(*) FROM kudos k WHERE k.run_share_id = sr.id) as kudos_count,
        (SELECT COUNT(*) FROM comments c WHERE c.run_share_id = sr.id) as comment_count,
        (SELECT emoji FROM kudos WHERE run_share_id = sr.id AND from_user_id = $1) as my_kudos
      FROM shared_runs sr
      WHERE sr.user_id IN (
        SELECT friend_id FROM friends WHERE user_id = $1 AND status = 'accepted'
      ) OR sr.user_id = $1
      ORDER BY sr.created_at DESC
      LIMIT 50
    `, [req.user.id]);
    
    // Tilføj kommentarer til hver post
    for (const row of rows) {
      const comments = await db.query(`
        SELECT c.comment, c.created_at, u.email, p.data as profile_data
        FROM comments c
        JOIN users u ON u.id = c.user_id
        LEFT JOIN profile p ON p.user_id = u.id
        WHERE c.run_share_id = $1
        ORDER BY c.created_at DESC
        LIMIT 3
      `, [row.id]);
      
      row.recentComments = comments.rows.map(c => ({
        comment: c.comment,
        createdAt: c.created_at,
        userName: c.profile_data ? JSON.parse(c.profile_data).name : c.email.split('@')[0],
      }));
    }
    
    res.json({ feed: rows });
  } catch (e) {
    res.json({ feed: [], error: e.message });
  }
});

// ─── GARMIN CONNECT INTEGRATION ───────────────────────────────────────────────
// Note: Garmin Connect API kræver partner-aftale med Garmin
// Dette er placeholder endpoints - kræver rigtige API credentials

app.get('/integrations/status', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT garmin_token, apple_health_enabled FROM integrations WHERE user_id = $1',
      [req.user.id]
    );
    
    res.json({
      garmin: !!result.rows[0]?.garmin_token,
      appleHealth: !!result.rows[0]?.apple_health_enabled,
    });
  } catch (e) {
    res.json({ garmin: false, appleHealth: false });
  }
});

app.post('/integrations/garmin/connect', authMiddleware, async (req, res) => {
  try {
    const { authCode } = req.body;
    
    // TODO: Exchange auth code for access token via Garmin OAuth
    // Dette kræver Garmin Developer Partner aftale
    // Se: https://developer.garmin.com/connect-iq/api-docs/
    
    // Placeholder response
    res.json({ 
      success: false, 
      message: 'Garmin integration kræver partner-aftale. Kontakt support.' 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/integrations/garmin/disconnect', authMiddleware, async (req, res) => {
  try {
    await db.query(
      'UPDATE integrations SET garmin_token = NULL, garmin_refresh_token = NULL WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/integrations/garmin/sync', authMiddleware, async (req, res) => {
  try {
    // Check for existing Garmin connection
    const result = await db.query(
      'SELECT garmin_token FROM integrations WHERE user_id = $1',
      [req.user.id]
    );
    
    if (!result.rows[0]?.garmin_token) {
      return res.status(400).json({ error: 'Garmin ikke forbundet' });
    }
    
    // TODO: Fetch activities from Garmin Connect API
    // Kræver valid access token
    
    res.json({ activities: [], message: 'Sync ikke implementeret endnu' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── APPLE HEALTH IMPORT ──────────────────────────────────────────────────────
app.post('/integrations/apple-health/import', authMiddleware, async (req, res) => {
  try {
    const { workouts } = req.body;
    if (!workouts || !Array.isArray(workouts)) {
      return res.status(400).json({ error: 'Ingen workouts data' });
    }
    
    let imported = 0;
    for (const workout of workouts) {
      // Konverter Apple Health format til RunWithAI format
      const run = {
        km: workout.totalDistance / 1000, // meters to km
        duration_secs: workout.duration,
        pace_secs_per_km: workout.duration / (workout.totalDistance / 1000),
        avg_hr: workout.averageHeartRate || null,
        date: workout.startDate,
        notes: JSON.stringify({ source: 'apple_health', originalId: workout.uuid }),
      };
      
      await db.query(
        'INSERT INTO runs (user_id, km, duration_secs, pace_secs_per_km, avg_hr, date, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [req.user.id, run.km, run.duration_secs, run.pace_secs_per_km, run.avg_hr, run.date, run.notes]
      );
      imported++;
    }
    
    // Opdater integration status
    await db.query(
      `INSERT INTO integrations (user_id, apple_health_enabled) VALUES ($1, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET apple_health_enabled = TRUE, updated_at = NOW()`,
      [req.user.id]
    );
    
    res.json({ imported, message: `${imported} løb importeret fra Apple Health` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => console.log(`RunWithAI server kører på port ${PORT} ✓`));
