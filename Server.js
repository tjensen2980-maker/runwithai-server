// ═══════════════════════════════════════════════════════════════════════════
// SERVER.JS - RunWithAI Backend v2.9.0-password-reset
// Med delete-account endpoint (Apple App Store krav)
// Med delete run endpoint
// Med social challenges & streaks
// Med AI photo story
// Med friends endpoints
// Med voice coach (Whisper + AI)
// Med password reset endpoints
// ═══════════════════════════════════════════════════════════════════════════
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const Stripe = require('stripe');
const multer = require('multer');
const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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

// ─── PASSWORD RESET CODES (in-memory store) ─────────────────────────────────
const resetCodes = new Map(); // email -> { code, expires, userId }

function generateResetCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

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
      console.log('🔄 Subscription updated:', status);
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
app.use(express.json({ limit: '10mb' }));
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

// ═══════════════════════════════════════════════════════════════════════════
// AUTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// PASSWORD RESET ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ─── FORGOT PASSWORD ────────────────────────────────────────────────────────
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email påkrævet' });
    }

    // Check if user exists
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      // Don't reveal if email exists - return success anyway for security
      return res.json({ success: true, message: 'Hvis emailen findes, sender vi en kode' });
    }

    const user = userResult.rows[0];
    const code = generateResetCode();
    const expires = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Store code
    resetCodes.set(email.toLowerCase(), { code, expires, userId: user.id });

    // Log code (for testing - in production this would only be sent via email)
    console.log(`[PASSWORD RESET] Code for ${email}: ${code}`);

    // Send email with code if SendGrid is configured
    if (process.env.SENDGRID_API_KEY) {
      try {
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        
        await sgMail.send({
          to: email,
          from: process.env.FROM_EMAIL || 'noreply@runwithai.app',
          subject: 'Nulstil din RunWithAI adgangskode',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #fa3c00; margin-bottom: 24px;">🏃 RunWithAI</h2>
              <p style="font-size: 16px; color: #333;">Hej!</p>
              <p style="font-size: 16px; color: #333;">Du har anmodet om at nulstille din adgangskode.</p>
              <p style="font-size: 16px; color: #333;">Din nulstillingskode er:</p>
              <div style="background: #f5f5f5; padding: 24px; text-align: center; font-size: 36px; font-weight: bold; letter-spacing: 6px; margin: 24px 0; border-radius: 12px; color: #fa3c00;">
                ${code}
              </div>
              <p style="font-size: 14px; color: #666;">Koden udløber om 15 minutter.</p>
              <p style="font-size: 14px; color: #666;">Hvis du ikke har anmodet om dette, kan du ignorere denne email.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
              <p style="font-size: 12px; color: #999;">Venlig hilsen,<br>RunWithAI Team</p>
            </div>
          `,
        });
        console.log(`[PASSWORD RESET] Email sent to ${email}`);
      } catch (emailErr) {
        console.error('[PASSWORD RESET] Email send failed:', emailErr.message);
        // Continue anyway - code is logged and user can request new code
      }
    }

    res.json({ success: true, message: 'Nulstillingskode sendt til din email' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Kunne ikke sende nulstillingskode' });
  }
});

// ─── RESET PASSWORD ─────────────────────────────────────────────────────────
app.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, kode og ny adgangskode påkrævet' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Adgangskode skal være mindst 6 tegn' });
    }

    // Check reset code
    const resetData = resetCodes.get(email.toLowerCase());
    
    if (!resetData) {
      return res.status(400).json({ error: 'Ingen nulstillingsanmodning fundet. Anmod om ny kode.' });
    }

    if (Date.now() > resetData.expires) {
      resetCodes.delete(email.toLowerCase());
      return res.status(400).json({ error: 'Koden er udløbet. Anmod om ny kode.' });
    }

    if (resetData.code !== code) {
      return res.status(400).json({ error: 'Forkert kode' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedPassword, resetData.userId]
    );

    // Remove used code
    resetCodes.delete(email.toLowerCase());

    console.log(`[PASSWORD RESET] Password updated for ${email}`);
    res.json({ success: true, message: 'Adgangskode nulstillet' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Kunne ikke nulstille adgangskode' });
  }
});

// ─── VERIFY RESET CODE (optional) ───────────────────────────────────────────
app.post('/verify-reset-code', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email og kode påkrævet' });
    }

    const resetData = resetCodes.get(email.toLowerCase());
    
    if (!resetData) {
      return res.status(400).json({ error: 'Ingen nulstillingsanmodning fundet' });
    }

    if (Date.now() > resetData.expires) {
      resetCodes.delete(email.toLowerCase());
      return res.status(400).json({ error: 'Koden er udløbet' });
    }

    if (resetData.code !== code) {
      return res.status(400).json({ error: 'Forkert kode' });
    }

    res.json({ valid: true });
  } catch (err) {
    console.error('Verify reset code error:', err);
    res.status(500).json({ error: 'Kunne ikke verificere kode' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// DELETE ACCOUNT ENDPOINT (Apple App Store krav)
// ═══════════════════════════════════════════════════════════════════════════
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

    // Clean up challenge data
    try { await pool.query('DELETE FROM streak_log WHERE user_id = $1', [userId]); } catch (e) {}
    try { await pool.query('DELETE FROM challenge_participants WHERE user_id = $1', [userId]); } catch (e) {}
    try { await pool.query("DELETE FROM challenges WHERE creator_id = $1 AND id NOT IN (SELECT challenge_id FROM challenge_participants)", [userId]); } catch (e) {}

    // Clean up photo story data
    try { await pool.query('DELETE FROM run_photos WHERE user_id = $1', [userId]); } catch (e) {}
    try { await pool.query('DELETE FROM run_stories WHERE user_id = $1', [userId]); } catch (e) {}

    // Clean up friends data
    try { await pool.query('DELETE FROM friends WHERE user_id = $1 OR friend_id = $1', [userId]); } catch (e) {}

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

// ═══════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
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

    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch (stripeErr) {
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

// ═══════════════════════════════════════════════════════════════════════════
// RUNS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
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

    const savedRun = result.rows[0];

    // ─── AUTO-LOG TO ACTIVE CHALLENGES ────────────────────────────────────
    try {
      await logChallengeActivity(req.userId, savedRun.id, savedRun.km, savedRun.date);
    } catch (chalErr) {
      console.warn('Challenge auto-log warning (run still saved):', chalErr.message);
    }

    res.json(savedRun);
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

// ═══════════════════════════════════════════════════════════════════════════
// CHALLENGES & STREAKS
// ═══════════════════════════════════════════════════════════════════════════

// Helper: generate a short invite code
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Helper: log activity to all active challenges for a user
async function logChallengeActivity(userId, runId, km, date) {
  const logDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

  const participations = await pool.query(`
    SELECT cp.*, c.type, c.target_value
    FROM challenge_participants cp
    JOIN challenges c ON c.id = cp.challenge_id
    WHERE cp.user_id = $1 AND cp.status = 'active' AND c.status = 'active'
  `, [userId]);

  for (const p of participations.rows) {
    // Upsert streak log for today
    await pool.query(`
      INSERT INTO streak_log (challenge_id, user_id, log_date, km, runs_count, run_id)
      VALUES ($1, $2, $3, $4, 1, $5)
      ON CONFLICT (challenge_id, user_id, log_date)
      DO UPDATE SET km = streak_log.km + $4, runs_count = streak_log.runs_count + 1
    `, [p.challenge_id, userId, logDate, km || 0, runId || null]);

    // Calculate current streak (consecutive days with activity)
    const streakResult = await pool.query(`
      WITH dates AS (
        SELECT DISTINCT log_date FROM streak_log
        WHERE challenge_id = $1 AND user_id = $2
        ORDER BY log_date DESC
      ),
      numbered AS (
        SELECT log_date,
               log_date - (ROW_NUMBER() OVER (ORDER BY log_date DESC))::int AS grp
        FROM dates
      )
      SELECT COUNT(*) as streak
      FROM numbered
      WHERE grp = (SELECT grp FROM numbered LIMIT 1)
    `, [p.challenge_id, userId]);

    const currentStreak = parseInt(streakResult.rows[0]?.streak || 0);
    const bestStreak = Math.max(currentStreak, p.best_streak);

    await pool.query(`
      UPDATE challenge_participants
      SET current_streak = $1,
          best_streak = $2,
          total_km = total_km + $3,
          total_runs = total_runs + 1,
          last_activity_date = $4
      WHERE challenge_id = $5 AND user_id = $6
    `, [currentStreak, bestStreak, km || 0, logDate, p.challenge_id, userId]);
  }
}

// ─── CREATE CHALLENGE ───────────────────────────────────────────────────────
app.post('/challenges', authMiddleware, async (req, res) => {
  try {
    const { title, description, type, target_value, target_period, end_date } = req.body;

    if (!title || !target_value) {
      return res.status(400).json({ error: 'Titel og mål er påkrævet' });
    }

    const inviteCode = generateInviteCode();

    const result = await pool.query(`
      INSERT INTO challenges (creator_id, title, description, type, target_value, target_period, end_date, invite_code)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      req.userId,
      title,
      description || null,
      type || 'streak',
      target_value,
      target_period || 'week',
      end_date || null,
      inviteCode,
    ]);

    const challenge = result.rows[0];

    // Auto-join creator
    await pool.query(`
      INSERT INTO challenge_participants (challenge_id, user_id)
      VALUES ($1, $2)
    `, [challenge.id, req.userId]);

    res.json(challenge);
  } catch (err) {
    console.error('Create challenge error:', err);
    res.status(500).json({ error: 'Kunne ikke oprette challenge' });
  }
});

// ─── GET MY CHALLENGES ──────────────────────────────────────────────────────
app.get('/challenges', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*,
             cp.current_streak, cp.best_streak, cp.total_km, cp.total_runs, cp.last_activity_date,
             cp.status as my_status,
             (SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = c.id) as participant_count,
             (SELECT json_agg(json_build_object(
               'user_id', cp2.user_id,
               'current_streak', cp2.current_streak,
               'best_streak', cp2.best_streak,
               'total_km', cp2.total_km,
               'total_runs', cp2.total_runs,
               'last_activity_date', cp2.last_activity_date,
               'name', p.data->>'name'
             ) ORDER BY cp2.current_streak DESC)
              FROM challenge_participants cp2
              LEFT JOIN profile p ON p.user_id = cp2.user_id
              WHERE cp2.challenge_id = c.id
             ) as leaderboard
      FROM challenges c
      JOIN challenge_participants cp ON cp.challenge_id = c.id AND cp.user_id = $1
      WHERE c.status = 'active'
      ORDER BY c.created_at DESC
    `, [req.userId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Get challenges error:', err);
    res.status(500).json({ error: 'Kunne ikke hente challenges' });
  }
});

// ─── JOIN CHALLENGE BY INVITE CODE ──────────────────────────────────────────
app.post('/challenges/join', authMiddleware, async (req, res) => {
  try {
    const { invite_code } = req.body;

    if (!invite_code) {
      return res.status(400).json({ error: 'Invite-kode påkrævet' });
    }

    const challenge = await pool.query(
      'SELECT * FROM challenges WHERE invite_code = $1 AND status = $2',
      [invite_code.toUpperCase(), 'active']
    );

    if (challenge.rows.length === 0) {
      return res.status(404).json({ error: 'Challenge ikke fundet eller er afsluttet' });
    }

    const ch = challenge.rows[0];

    const existing = await pool.query(
      'SELECT id FROM challenge_participants WHERE challenge_id = $1 AND user_id = $2',
      [ch.id, req.userId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Du er allerede med i denne challenge' });
    }

    await pool.query(`
      INSERT INTO challenge_participants (challenge_id, user_id)
      VALUES ($1, $2)
    `, [ch.id, req.userId]);

    res.json({ success: true, challenge: ch });
  } catch (err) {
    console.error('Join challenge error:', err);
    res.status(500).json({ error: 'Kunne ikke tilmelde challenge' });
  }
});

// ─── LOG ACTIVITY (manual – auto-log happens in POST /runs) ─────────────────
app.post('/challenges/log', authMiddleware, async (req, res) => {
  try {
    const { run_id, km, date } = req.body;
    await logChallengeActivity(req.userId, run_id, km, date);
    res.json({ success: true });
  } catch (err) {
    console.error('Log challenge activity error:', err);
    res.status(500).json({ error: 'Kunne ikke logge aktivitet' });
  }
});

// ─── GET CHALLENGE DETAILS ──────────────────────────────────────────────────
app.get('/challenges/:id', authMiddleware, async (req, res) => {
  try {
    const challengeId = req.params.id;

    const challenge = await pool.query('SELECT * FROM challenges WHERE id = $1', [challengeId]);
    if (challenge.rows.length === 0) {
      return res.status(404).json({ error: 'Challenge ikke fundet' });
    }

    const participants = await pool.query(`
      SELECT cp.*, p.data->>'name' as name
      FROM challenge_participants cp
      LEFT JOIN profile p ON p.user_id = cp.user_id
      WHERE cp.challenge_id = $1
      ORDER BY cp.current_streak DESC, cp.total_km DESC
    `, [challengeId]);

    const recentActivity = await pool.query(`
      SELECT sl.*, p.data->>'name' as name
      FROM streak_log sl
      LEFT JOIN profile p ON p.user_id = sl.user_id
      WHERE sl.challenge_id = $1 AND sl.log_date >= CURRENT_DATE - 7
      ORDER BY sl.log_date DESC, sl.created_at DESC
    `, [challengeId]);

    res.json({
      ...challenge.rows[0],
      participants: participants.rows,
      recent_activity: recentActivity.rows,
    });
  } catch (err) {
    console.error('Get challenge details error:', err);
    res.status(500).json({ error: 'Kunne ikke hente challenge-detaljer' });
  }
});

// ─── LEAVE CHALLENGE ────────────────────────────────────────────────────────
app.delete('/challenges/:id/leave', authMiddleware, async (req, res) => {
  try {
    const challengeId = req.params.id;

    await pool.query(
      'DELETE FROM challenge_participants WHERE challenge_id = $1 AND user_id = $2',
      [challengeId, req.userId]
    );

    const remaining = await pool.query(
      'SELECT COUNT(*) as count FROM challenge_participants WHERE challenge_id = $1',
      [challengeId]
    );

    if (parseInt(remaining.rows[0].count) === 0) {
      await pool.query("UPDATE challenges SET status = 'canceled' WHERE id = $1", [challengeId]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Leave challenge error:', err);
    res.status(500).json({ error: 'Kunne ikke forlade challenge' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PHOTO STORY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ─── UPLOAD PHOTO DURING RUN ────────────────────────────────────────────────
app.post('/runs/:runId/photos', authMiddleware, async (req, res) => {
  try {
    const { runId } = req.params;
    const { image_base64, latitude, longitude, timestamp, caption } = req.body;

    if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });

    // Verify run belongs to user
    const run = await pool.query('SELECT id FROM runs WHERE id = $1 AND user_id = $2', [runId, req.userId]);
    if (run.rows.length === 0) return res.status(404).json({ error: 'Run not found' });

    const result = await pool.query(
      `INSERT INTO run_photos (run_id, user_id, image_base64, latitude, longitude, taken_at, caption)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, latitude, longitude, taken_at, caption`,
      [runId, req.userId, image_base64, latitude || null, longitude || null, timestamp || new Date(), caption || null]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Upload photo error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET PHOTOS FOR A RUN ───────────────────────────────────────────────────
app.get('/runs/:runId/photos', authMiddleware, async (req, res) => {
  try {
    const { runId } = req.params;
    const result = await pool.query(
      `SELECT id, image_base64, latitude, longitude, taken_at, caption
       FROM run_photos WHERE run_id = $1 AND user_id = $2
       ORDER BY taken_at ASC`,
      [runId, req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get photos error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GENERATE AI STORY FROM RUN + PHOTOS ────────────────────────────────────
app.post('/runs/:runId/story', authMiddleware, async (req, res) => {
  try {
    const { runId } = req.params;

    // Get run data
    const run = await pool.query(
      'SELECT * FROM runs WHERE id = $1 AND user_id = $2',
      [runId, req.userId]
    );
    if (run.rows.length === 0) return res.status(404).json({ error: 'Run not found' });

    // Get photos
    const photos = await pool.query(
      `SELECT id, latitude, longitude, taken_at, caption FROM run_photos
       WHERE run_id = $1 AND user_id = $2 ORDER BY taken_at ASC`,
      [runId, req.userId]
    );

    // Get user profile for name
    const profile = await pool.query('SELECT data FROM profile WHERE user_id = $1', [req.userId]);
    const profileData = profile.rows[0]?.data;
    const userName = (typeof profileData === 'string' ? JSON.parse(profileData) : profileData)?.name || 'Løber';

    const runData = run.rows[0];
    const km = parseFloat(runData.km || 0).toFixed(1);
    const duration = runData.duration || 'ukendt';
    const photoCount = photos.rows.length;

    // Build prompt for AI story
    const photoDescriptions = photos.rows.map((p, i) => {
      const time = new Date(p.taken_at).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
      return `Foto ${i + 1}: taget kl. ${time}${p.caption ? ` – "${p.caption}"` : ''}${p.latitude ? ` (${parseFloat(p.latitude).toFixed(4)}, ${parseFloat(p.longitude).toFixed(4)})` : ''}`;
    }).join('\n');

    const prompt = `Du er en kreativ løbe-historiefortæller for appen RunWithAI. Skriv en kort, engagerende løbe-story på dansk (max 200 ord) baseret på dette løb:

Løber: ${userName}
Distance: ${km} km
Varighed: ${duration}
Antal fotos: ${photoCount}
${photoDescriptions ? `\nFotos undervejs:\n${photoDescriptions}` : ''}

Skriv en livlig, motiverende fortælling i 2. person ("du") der beskriver løbeturen som en eventyrlig rejse. Brug foto-tidspunkterne og eventuelle captions til at flette billederne naturligt ind i historien. Tilføj emoji hvor det passer. Afslut med en opmuntrende kommentar.

Svar KUN med selve historieteksten, ingen overskrift.`;

    // Call OpenAI
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.8,
      }),
    });

    const aiData = await openaiRes.json();
    const storyText = aiData.choices?.[0]?.message?.content || 'Kunne ikke generere story.';

    // Save story (upsert)
    const existing = await pool.query(
      'SELECT id FROM run_stories WHERE run_id = $1', [runId]
    );

    let storyResult;
    if (existing.rows.length > 0) {
      storyResult = await pool.query(
        `UPDATE run_stories SET story_text = $1, updated_at = NOW() WHERE run_id = $2 RETURNING *`,
        [storyText, runId]
      );
    } else {
      storyResult = await pool.query(
        `INSERT INTO run_stories (run_id, user_id, story_text) VALUES ($1, $2, $3) RETURNING *`,
        [runId, req.userId, storyText]
      );
    }

    res.json({
      story: storyResult.rows[0],
      photos: photos.rows,
      run: { km, duration, date: runData.date || runData.created_at },
    });
  } catch (err) {
    console.error('Generate story error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET EXISTING STORY ─────────────────────────────────────────────────────
app.get('/runs/:runId/story', authMiddleware, async (req, res) => {
  try {
    const { runId } = req.params;
    const story = await pool.query(
      'SELECT * FROM run_stories WHERE run_id = $1 AND user_id = $2',
      [runId, req.userId]
    );
    if (story.rows.length === 0) return res.status(404).json({ error: 'No story yet' });

    const photos = await pool.query(
      `SELECT id, image_base64, latitude, longitude, taken_at, caption
       FROM run_photos WHERE run_id = $1 AND user_id = $2 ORDER BY taken_at ASC`,
      [runId, req.userId]
    );

    res.json({ story: story.rows[0], photos: photos.rows });
  } catch (err) {
    console.error('Get story error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── SHARE STORY TO FEED ────────────────────────────────────────────────────
app.post('/runs/:runId/story/share', authMiddleware, async (req, res) => {
  try {
    const { runId } = req.params;

    const story = await pool.query(
      'SELECT * FROM run_stories WHERE run_id = $1 AND user_id = $2',
      [runId, req.userId]
    );
    if (story.rows.length === 0) return res.status(404).json({ error: 'Generate story first' });

    await pool.query(
      'UPDATE run_stories SET shared = true, shared_at = NOW() WHERE run_id = $1',
      [runId]
    );

    res.json({ success: true, message: 'Story delt!' });
  } catch (err) {
    console.error('Share story error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET SHARED STORIES FROM FRIENDS ────────────────────────────────────────
app.get('/feed/stories', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rs.*, r.km, r.duration, r.date, p.data->>'name' as name,
        (SELECT COUNT(*) FROM run_photos rp WHERE rp.run_id = rs.run_id) as photo_count
       FROM run_stories rs
       JOIN runs r ON r.id = rs.run_id
       LEFT JOIN profile p ON p.user_id = rs.user_id
       WHERE rs.shared = true
         AND (rs.user_id = $1 OR rs.user_id IN (
           SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END
           FROM friends WHERE (user_id = $1 OR friend_id = $1) AND status = 'accepted'
         ))
       ORDER BY rs.shared_at DESC LIMIT 20`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get feed stories error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TRAINING PLAN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// WEEK PLAN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// TTS ENDPOINT (OpenAI gpt-4o-mini-tts – natural voice with instructions)
// ═══════════════════════════════════════════════════════════════════════════
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
        voice: voice || 'marin',
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

// ═══════════════════════════════════════════════════════════════════════════
// AI CHAT ENDPOINT (proxy to Anthropic API)
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGES ENDPOINTS (chat history)
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// FRIENDS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET MY FRIENDS ─────────────────────────────────────────────────────────
app.get('/friends', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.id, f.status, f.created_at,
        CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END as friend_user_id,
        p.data->>'name' as name,
        p.data->>'avatar' as avatar
      FROM friends f
      LEFT JOIN profile p ON p.user_id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
      WHERE (f.user_id = $1 OR f.friend_id = $1)
      ORDER BY f.created_at DESC
    `, [req.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Get friends error:', err);
    res.status(500).json({ error: 'Kunne ikke hente venner' });
  }
});

// ─── SEND FRIEND REQUEST ────────────────────────────────────────────────────
app.post('/friends/request', authMiddleware, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email påkrævet' });

    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bruger ikke fundet' });
    }

    const friendId = userResult.rows[0].id;
    if (friendId === req.userId) {
      return res.status(400).json({ error: 'Du kan ikke tilføje dig selv' });
    }

    const existing = await pool.query(
      `SELECT id, status FROM friends
       WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
      [req.userId, friendId]
    );

    if (existing.rows.length > 0) {
      const status = existing.rows[0].status;
      if (status === 'accepted') return res.status(400).json({ error: 'I er allerede venner' });
      if (status === 'pending') return res.status(400).json({ error: 'Anmodning allerede sendt' });
    }

    await pool.query(
      `INSERT INTO friends (user_id, friend_id, status, created_at)
       VALUES ($1, $2, 'pending', NOW())`,
      [req.userId, friendId]
    );

    res.json({ success: true, message: 'Anmodning sendt!' });
  } catch (err) {
    console.error('Friend request error:', err);
    res.status(500).json({ error: 'Kunne ikke sende anmodning' });
  }
});

// ─── RESPOND TO FRIEND REQUEST ──────────────────────────────────────────────
app.post('/friends/:id/respond', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { accept } = req.body;

    if (accept) {
      await pool.query(
        `UPDATE friends SET status = 'accepted' WHERE id = $1 AND friend_id = $2`,
        [id, req.userId]
      );
      res.json({ success: true, message: 'Venneanmodning accepteret!' });
    } else {
      await pool.query(
        `DELETE FROM friends WHERE id = $1 AND friend_id = $2`,
        [id, req.userId]
      );
      res.json({ success: true, message: 'Venneanmodning afvist' });
    }
  } catch (err) {
    console.error('Respond to friend error:', err);
    res.status(500).json({ error: 'Kunne ikke svare på anmodning' });
  }
});

// ─── REMOVE FRIEND ──────────────────────────────────────────────────────────
app.delete('/friends/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `DELETE FROM friends WHERE id = $1 AND (user_id = $2 OR friend_id = $2)`,
      [id, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Remove friend error:', err);
    res.status(500).json({ error: 'Kunne ikke fjerne ven' });
  }
});

// ─── FRIENDS FEED ───────────────────────────────────────────────────────────
app.get('/friends/feed', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.km, r.duration, r.pace, r.date, r.type, r.created_at,
        p.data->>'name' as name,
        p.data->>'avatar' as avatar,
        r.user_id
      FROM runs r
      JOIN profile p ON p.user_id = r.user_id
      WHERE r.user_id IN (
        SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END
        FROM friends
        WHERE (user_id = $1 OR friend_id = $1) AND status = 'accepted'
      )
      AND r.created_at > NOW() - INTERVAL '7 days'
      ORDER BY r.created_at DESC
      LIMIT 20
    `, [req.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Friends feed error:', err);
    res.status(500).json({ error: 'Kunne ikke hente feed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// VOICE COACH ENDPOINT (Whisper transcription + AI response)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/voice-coach', authMiddleware, upload.single('audio'), async (req, res) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API not configured' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file' });
    }

    // Get user profile for name
    const profileResult = await pool.query('SELECT data FROM profile WHERE user_id = $1', [req.userId]);
    const profileData = profileResult.rows[0]?.data;
    const userName = (typeof profileData === 'string' ? JSON.parse(profileData) : profileData)?.name || 'løber';

    // Parse run context
    let runContext = {};
    try {
      if (req.body.context) runContext = JSON.parse(req.body.context);
    } catch {}

    // ─── Step 1: Transcribe with Whisper ──────────────────────────────────
    const whisperForm = new FormData();
    const audioBlob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/m4a' });
    whisperForm.append('file', audioBlob, 'voice.m4a');
    whisperForm.append('model', 'whisper-1');
    whisperForm.append('language', 'da');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: whisperForm,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      console.error('Whisper error:', err);
      return res.status(500).json({ error: 'Transcription failed' });
    }

    const whisperData = await whisperRes.json();
    const userText = whisperData.text;
    console.log(`[VoiceCoach] User said: "${userText}"`);

    if (!userText || userText.trim().length === 0) {
      return res.json({ text: 'Jeg hørte dig ikke helt, prøv igen.', transcription: '' });
    }

    // ─── Step 2: AI Coach response ────────────────────────────────────────
    const kmStr = runContext.km ? `${runContext.km.toFixed(1)} km` : 'ukendt';
    const paceStr = runContext.pace ? `${Math.floor(runContext.pace)}:${String(Math.round((runContext.pace % 1) * 60)).padStart(2, '0')} min/km` : 'ukendt';
    const durationMins = runContext.duration ? Math.floor(runContext.duration / 60) : 0;

    const systemPrompt = `Du er en venlig og energisk dansk løbecoach i appen RunWithAI. Brugeren hedder ${userName} og er midt i et løb.

Aktuelle løbdata:
- Distance: ${kmStr}
- Pace: ${paceStr}
- Tid: ${durationMins} minutter

Regler:
- Svar KORT (max 2-3 sætninger) – brugeren løber og kan ikke læse lange svar
- Vær opmuntrende og positiv
- Svar på dansk
- Hvis de spørger om deres tempo/distance, brug de aktuelle data
- Hvis de beder om motivation, giv en kort energisk peptalk
- Hvis de vil vide noget om løb/træning, giv et kort svar`;

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    const aiData = await aiRes.json();
    const responseText = aiData.choices?.[0]?.message?.content || 'Godt klaret, bliv ved!';
    console.log(`[VoiceCoach] AI response: "${responseText}"`);

    res.json({
      text: responseText,
      transcription: userText,
    });
  } catch (err) {
    console.error('Voice coach error:', err);
    res.status(500).json({ error: 'Voice coach fejl' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROOT ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({ status: 'RunWithAI server kører!', version: '2.9.0-password-reset' });
});

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🏃 RunWithAI server kører på port ${PORT}`);
  console.log(`📦 Version: 2.9.0-password-reset`);
});