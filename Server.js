// ═══════════════════════════════════════════════════════════════════════════════
// SERVER.JS - RunWithAI Backend v2.3.0-stripe
// Med delete-account endpoint (Apple App Store krav)
// Med delete run endpoint
// ═══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const Stripe = require('stripe');
const app = express();
const PORT = process.env.PORT || 3000;
// ─── DATABASE ───────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
// ─── STRIPE ─────────────────────────────────────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
// ─── SUBSCRIPTION TIERS ─────────────────────────────────────────────────────
const TIERS = {
  free: {
    maxRunsPerMonth: 10,
    features: ['basic_tracking', 'weekly_stats']
  },
  pro: {
    maxRunsPerMonth: Infinity,
    features: ['basic_tracking', 'weekly_stats', 'ai_coach', 'badges', 'streaks', 'pulse_zones', 'garmin_sync', 'social_feed', 'export_data', 'unlimited_runs']
  }
};
// ─── MIDDLEWARE ─────────────────────────────────────────────────────────────
// Stripe webhook MUST be before express.json()
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer;
      const subscriptionId = session.subscription;
      await pool.query(`
        UPDATE users 
        SET subscription_tier = 'pro',
            subscription_status = 'active',
            stripe_subscription_id = $1
        WHERE stripe_customer_id = $2
      `, [subscriptionId, customerId]);
      console.log('✅ Subscription activated for customer:', customerId);
      break;
    }
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const status = subscription.status;
      const customerId = subscription.customer;
      await pool.query(`
        UPDATE users 
        SET subscription_status = $1,
            subscription_ends_at = to_timestamp($2)
        WHERE stripe_customer_id = $3
      `, [status, subscription.current_period_end, customerId]);
      console.log('📝 Subscription updated:', status);
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      await pool.query(`
        UPDATE users 
        SET subscription_tier = 'free',
            subscription_status = 'canceled',
            stripe_subscription_id = NULL
        WHERE stripe_customer_id = $1
      `, [customerId]);
      console.log('❌ Subscription canceled for customer:', customerId);
      break;
    }
  }
  res.json({ received: true });
});
// JSON parsing for other routes
app.use(express.json());
app.use(cors());
// ─── JWT SECRET ─────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'runwithai-secret-key-2024';
// ─── AUTH MIDDLEWARE ────────────────────────────────────────────────────────
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke logget ind' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Ugyldig token' });
  }
};
// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email og adgangskode påkrævet' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email er allerede registreret' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password, subscription_tier, subscription_status, created_at) 
       VALUES ($1, $2, 'free', 'active', NOW()) 
       RETURNING id, email`,
      [email.toLowerCase(), hashedPassword]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Kunne ikke oprette bruger' });
  }
});
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email og adgangskode påkrævet' });
    }
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Forkert email eller adgangskode' });
    }
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Forkert email eller adgangskode' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        email: user.email,
        subscription_tier: user.subscription_tier || 'free'
      } 
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login fejlede' });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT data FROM profile WHERE user_id = $1',
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.json(null);
    }
    res.json(result.rows[0].data);
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Kunne ikke hente profil' });
  }
});
app.put('/profile', authMiddleware, async (req, res) => {
  try {
    const profileData = req.body;
    await pool.query(`
      INSERT INTO profile (user_id, data, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) 
      DO UPDATE SET data = $2, updated_at = NOW()
    `, [req.userId, JSON.stringify(profileData)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Save profile error:', err);
    res.status(500).json({ error: 'Kunne ikke gemme profil' });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
// DELETE ACCOUNT ENDPOINT (Apple App Store krav)
// ═══════════════════════════════════════════════════════════════════════════════
app.delete('/delete-account', authMiddleware, async (req, res) => {
  const userId = req.userId;
  console.log(`Delete account request for userId: ${userId}`);
  
  try {
    await pool.query('BEGIN');
    
    const userResult = await pool.query(
      'SELECT email, stripe_customer_id FROM users WHERE id = $1', 
      [userId]
    );
    const user = userResult.rows[0];
    
    if (!user) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Bruger ikke fundet' });
    }
    
    console.log(`Deleting account for: ${user.email}`);
    
    if (user.stripe_customer_id && stripe) {
      try {
        const subscriptions = await stripe.subscriptions.list({
          customer: user.stripe_customer_id,
          status: 'active',
        });
        for (const sub of subscriptions.data) {
          await stripe.subscriptions.cancel(sub.id);
          console.log(`Cancelled subscription: ${sub.id}`);
        }
      } catch (stripeErr) {
        console.log('Stripe cleanup warning (continuing):', stripeErr.message);
      }
    }
    
    try { await pool.query('DELETE FROM runs WHERE user_id = $1', [userId]); } catch (e) {}
    try { await pool.query('DELETE FROM training_plan WHERE user_id = $1', [userId]); } catch (e) {}
    try { await pool.query('DELETE FROM week_plan WHERE user_id = $1', [userId]); } catch (e) {}
    try { await pool.query('DELETE FROM profile WHERE user_id = $1', [userId]); } catch (e) {}
    
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('COMMIT');
    
    console.log(`✅ Account deleted successfully: userId=${userId}, email=${user.email}`);
    res.json({ success: true, message: 'Din konto og alle data er blevet slettet permanent.' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('❌ Delete account error:', err);
    res.status(500).json({ error: 'Kunne ikke slette konto. Prøv igen senere.' });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/subscription', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT subscription_tier, subscription_status, subscription_ends_at 
       FROM users WHERE id = $1`,
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bruger ikke fundet' });
    }
    const user = result.rows[0];
    const tier = user.subscription_tier || 'free';
    const tierConfig = TIERS[tier] || TIERS.free;
    const runsResult = await pool.query(`
      SELECT COUNT(*) as count FROM runs 
      WHERE user_id = $1 
      AND date >= date_trunc('month', CURRENT_DATE)
    `, [req.userId]);
    const runsThisMonth = parseInt(runsResult.rows[0].count);
    const canTrackRun = tier === 'pro' || runsThisMonth < tierConfig.maxRunsPerMonth;
    res.json({
      tier,
      status: user.subscription_status || 'active',
      endsAt: user.subscription_ends_at,
      features: tierConfig.features,
      runsThisMonth,
      maxRunsPerMonth: tierConfig.maxRunsPerMonth,
      canTrackRun
    });
  } catch (err) {
    console.error('Get subscription error:', err);
    res.status(500).json({ error: 'Kunne ikke hente abonnement' });
  }
});
app.post('/create-checkout-session', authMiddleware, async (req, res) => {
  try {
    const { interval } = req.body;
    const userResult = await pool.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.userId]);
    const user = userResult.rows[0];
    let customerId = user.stripe_customer_id;
    
    // Validate existing customer or create new one
    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch (stripeErr) {
        // Customer doesn't exist (e.g., was created in test mode) - create new one
        console.log('Customer not found in Stripe, creating new:', customerId);
        customerId = null;
      }
    }
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: req.userId.toString() }
      });
      customerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.userId]);
      console.log('Created new Stripe customer:', customerId);
    }
    
    const priceId = interval === 'yearly' 
      ? process.env.STRIPE_PRICE_PRO_YEARLY 
      : process.env.STRIPE_PRICE_PRO_MONTHLY;
    console.log('Creating checkout session with price:', priceId, 'for customer:', customerId);
    
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.APP_URL}?subscription=success`,
      cancel_url: `${process.env.APP_URL}?subscription=canceled`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Create checkout error:', err);
    res.status(500).json({ error: 'Kunne ikke starte checkout' });
  }
});
app.post('/create-portal-session', authMiddleware, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT stripe_customer_id FROM users WHERE id = $1', [req.userId]);
    const customerId = userResult.rows[0]?.stripe_customer_id;
    if (!customerId) {
      return res.status(400).json({ error: 'Ingen Stripe kunde fundet' });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: process.env.APP_URL,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Create portal error:', err);
    res.status(500).json({ error: 'Kunne ikke åbne kundeportal' });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
// RUNS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/runs', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM runs WHERE user_id = $1 ORDER BY date DESC',
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get runs error:', err);
    res.status(500).json({ error: 'Kunne ikke hente løb' });
  }
});
app.post('/runs', authMiddleware, async (req, res) => {
  try {
    const run = req.body;
    const result = await pool.query(`
      INSERT INTO runs (user_id, date, km, duration, pace, calories, heart_rate, route, notes, type, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *
    `, [
      req.userId,
      run.date || new Date(),
      run.km,
      run.duration,
      run.pace,
      run.calories,
      run.heart_rate,
      run.route ? JSON.stringify(run.route) : null,
      run.notes,
      run.type || 'run'
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Save run error:', err);
    res.status(500).json({ error: 'Kunne ikke gemme løb' });
  }
});

// DELETE a single run (only own runs)
app.delete('/runs/:id', authMiddleware, async (req, res) => {
  try {
    const runId = req.params.id;
    const result = await pool.query(
      'DELETE FROM runs WHERE id = $1 AND user_id = $2 RETURNING id',
      [runId, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Løb ikke fundet' });
    }
    res.json({ success: true, deletedId: result.rows[0].id });
  } catch (err) {
    console.error('Delete run error:', err);
    res.status(500).json({ error: 'Kunne ikke slette løb' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING PLAN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/trainingplan', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM training_plan WHERE user_id = $1 ORDER BY generated_at DESC LIMIT 1',
      [req.userId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('Get training plan error:', err);
    res.status(500).json({ error: 'Kunne ikke hente træningsplan' });
  }
});
app.post('/trainingplan/save', authMiddleware, async (req, res) => {
  try {
    const { data } = req.body;
    await pool.query(`
      INSERT INTO training_plan (user_id, data, generated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) 
      DO UPDATE SET data = $2, generated_at = NOW()
    `, [req.userId, JSON.stringify(data)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Save training plan error:', err);
    res.status(500).json({ error: 'Kunne ikke gemme træningsplan' });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
// WEEK PLAN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/weekplan', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM week_plan WHERE user_id = $1',
      [req.userId]
    );
    res.json(result.rows[0]?.data || null);
  } catch (err) {
    console.error('Get week plan error:', err);
    res.status(500).json({ error: 'Kunne ikke hente ugeplan' });
  }
});
app.post('/weekplan', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    await pool.query(`
      INSERT INTO week_plan (user_id, data, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) 
      DO UPDATE SET data = $2, updated_at = NOW()
    `, [req.userId, JSON.stringify(data)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Save week plan error:', err);
    res.status(500).json({ error: 'Kunne ikke gemme ugeplan' });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
// TTS ENDPOINT (OpenAI gpt-4o-mini-tts — natural voice with instructions)
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/tts', authMiddleware, async (req, res) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'TTS ikke konfigureret (mangler OpenAI API nøgle)' });
    }
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Mangler text' });

    const openaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: text,
        voice: voice || 'coral',
        instructions: 'Du er en venlig og energisk dansk løbecoach. Tal tydeligt og naturligt på dansk med et opmuntrende tonefald. Hold en rolig men motiverende stemme.',
        response_format: 'mp3',
        speed: 1.0,
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.text();
      console.error('OpenAI TTS error:', err);
      return res.status(openaiRes.status).json({ error: 'TTS fejl' });
    }

    // Stream MP3 direkte til klienten
    res.set({
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
    });
    const buffer = Buffer.from(await openaiRes.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({ error: 'TTS fejl' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI CHAT ENDPOINT (proxy to Anthropic API)
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/chat', authMiddleware, async (req, res) => {
  try {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'AI coach ikke konfigureret (mangler API nøgle)' });
    }
    const { model, max_tokens, system, messages } = req.body;
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 2000,
        system: system || '',
        messages: messages || [],
      }),
    });
    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      console.error('Anthropic API error:', data);
      return res.status(anthropicRes.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'AI coach fejl' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES ENDPOINTS (chat history)
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/messages', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT data FROM messages WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [req.userId]
    );
    if (result.rows.length === 0) return res.json([]);
    const data = result.rows[0].data;
    if (typeof data === 'string') {
      try { return res.json(JSON.parse(data)); } catch {}
    }
    res.json(data || []);
  } catch (err) {
    console.error('Get messages error:', err);
    res.json([]);
  }
});

app.post('/messages', authMiddleware, async (req, res) => {
  try {
    const { messages } = req.body;
    await pool.query(`
      INSERT INTO messages (user_id, data, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET data = $2, updated_at = NOW()
    `, [req.userId, JSON.stringify(messages)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Save messages error:', err);
    res.status(500).json({ error: 'Kunne ikke gemme beskeder' });
  }
});

app.delete('/messages', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM messages WHERE user_id = $1', [req.userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete messages error:', err);
    res.status(500).json({ error: 'Kunne ikke slette beskeder' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({ status: 'RunWithAI server kører!', version: '2.4.0-stripe' });
});
// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🏃 RunWithAI server kører på port ${PORT}`);
  console.log(`📦 Version: 2.4.0-stripe`);
});
