// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SERVER.JS - RunWithAI Backend v3.0.1-revenuecat
// Med Apple In-App Purchase support
// Med RevenueCat subscription activate endpoint
// Med delete-account endpoint (Apple App Store krav)
// Med delete run endpoint
// Med social challenges & streaks
// Med AI photo story
// Med friends endpoints
// Med voice coach (Whisper + AI)
// Med password reset endpoints
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const Stripe = require('stripe');
const multer = require('multer');
const { registerStrengthEndpoints } = require('./strengthEndpoints');
const { registerMealPlanEndpoints } = require('./mealPlanEndpoints');
const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// â”€â”€â”€ DATABASE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// â”€â”€â”€ STRIPE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// â”€â”€â”€ SUBSCRIPTION TIERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ PASSWORD RESET CODES (in-memory store) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const resetCodes = new Map(); // email -> { code, expires, userId }
const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function generateResetCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// â”€â”€â”€ MIDDLEWARE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      console.log('âœ… Subscription activated for customer:', customerId);
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
      console.log('ðŸ”„ Subscription updated:', status);
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
      console.log('âŒ Subscription canceled for customer:', customerId);
      break;
    }
  }
  res.json({ received: true });
});

// JSON parsing for other routes
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// â”€â”€â”€ JWT SECRET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const JWT_SECRET = process.env.JWT_SECRET || 'runwithai-secret-key-2024';

// â”€â”€â”€ AUTH MIDDLEWARE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AUTH ENDPOINTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email og adgangskode pÃ¥krÃ¦vet' });
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
      return res.status(400).json({ error: 'Email og adgangskode pÃ¥krÃ¦vet' });
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PASSWORD RESET ENDPOINTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€â”€ FORGOT PASSWORD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email pÃ¥krÃ¦vet' });
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

    // Send email with code using Resend
    if (resend) {
      try {
        await resend.emails.send({
          from: 'RunWithAI <noreply@runwithai.app>',
          to: email,
          subject: 'Nulstil din RunWithAI adgangskode',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #fa3c00; margin-bottom: 24px;">ðŸƒ RunWithAI</h2>
              <p style="font-size: 16px; color: #333;">Hej!</p>
              <p style="font-size: 16px; color: #333;">Du har anmodet om at nulstille din adgangskode.</p>
              <p style="font-size: 16px; color: #333;">Din nulstillingskode er:</p>
              <div style="background: #f5f5f5; padding: 24px; text-align: center; font-size: 36px; font-weight: bold; letter-spacing: 6px; margin: 24px 0; border-radius: 12px; color: #fa3c00;">
                ${code}
              </div>
              <p style="font-size: 14px; color: #666;">Koden udlÃ¸ber om 15 minutter.</p>
              <p style="font-size: 14px; color: #666;">Hvis du ikke har anmodet om dette, kan du ignorere denne email.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
              <p style="font-size: 12px; color: #999;">Venlig hilsen,<br>RunWithAI Team</p>
            </div>
          `,
        });
        console.log(`[PASSWORD RESET] Email sent to ${email} via Resend`);
      } catch (emailErr) {
        console.error('[PASSWORD RESET] Resend email failed:', emailErr.message);
      }
    }

    res.json({ success: true, message: 'Nulstillingskode sendt til din email' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Kunne ikke sende nulstillingskode' });
  }
});

// â”€â”€â”€ RESET PASSWORD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, kode og ny adgangskode pÃ¥krÃ¦vet' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Adgangskode skal vÃ¦re mindst 6 tegn' });
    }

    // Check reset code
    const resetData = resetCodes.get(email.toLowerCase());
    
    if (!resetData) {
      return res.status(400).json({ error: 'Ingen nulstillingsanmodning fundet. Anmod om ny kode.' });
    }

    if (Date.now() > resetData.expires) {
      resetCodes.delete(email.toLowerCase());
      return res.status(400).json({ error: 'Koden er udlÃ¸bet. Anmod om ny kode.' });
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

// â”€â”€â”€ VERIFY RESET CODE (optional) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/verify-reset-code', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email og kode pÃ¥krÃ¦vet' });
    }

    const resetData = resetCodes.get(email.toLowerCase());
    
    if (!resetData) {
      return res.status(400).json({ error: 'Ingen nulstillingsanmodning fundet' });
    }

    if (Date.now() > resetData.expires) {
      resetCodes.delete(email.toLowerCase());
      return res.status(400).json({ error: 'Koden er udlÃ¸bet' });
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PROFILE ENDPOINTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DELETE ACCOUNT ENDPOINT (Apple App Store krav)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

    console.log(`âœ… Account deleted successfully: userId=${userId}, email=${user.email}`);
    res.json({ success: true, message: 'Din konto og alle data er blevet slettet permanent.' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('âŒ Delete account error:', err);
    res.status(500).json({ error: 'Kunne ikke slette konto. PrÃ¸v igen senere.' });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SUBSCRIPTION ENDPOINTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

// ─── ACTIVITY LIMIT HELPER (Free tier: 3/week) ────────────────────
async function checkActivityLimit(userId) {
  try {
    // Get user tier
    const userResult = await pool.query(
      'SELECT subscription_tier, subscription_status FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return { allowed: true }; // fail-open
    }
    const { subscription_tier, subscription_status } = userResult.rows[0];
    const isActive = subscription_status === 'active' || subscription_status === 'trialing';
    const effectiveTier = isActive ? (subscription_tier || 'free') : 'free';

    // Basic and Pro have no limit
    if (effectiveTier !== 'free') {
      return { allowed: true };
    }

    // Free: count activities in last 7 days from BOTH tables
    const runsResult = await pool.query(
      "SELECT COUNT(*)::int AS c FROM runs WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'",
      [userId]
    );
    const actsResult = await pool.query(
      "SELECT COUNT(*)::int AS c FROM activities WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'",
      [userId]
    );
    const count = (runsResult.rows[0]?.c || 0) + (actsResult.rows[0]?.c || 0);
    const limit = 3;

    return {
      allowed: count < limit,
      count,
      limit,
      tier: effectiveTier
    };
  } catch (err) {
    console.error('checkActivityLimit error:', err);
    return { allowed: true }; // fail-open on errors
  }
}

// â”€â”€â”€ ACTIVATE SUBSCRIPTION (fra RevenueCat) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/subscription/activate', authMiddleware, async (req, res) => {
  try {
    const { revenueCatId, tier } = req.body;
    const userId = req.userId;

    // Validate tier (default 'pro' for backwards compatibility)
    const validTier = (tier === 'basic' || tier === 'pro') ? tier : 'pro';

    console.log('[RevenueCat] Activating ' + validTier + ' for user ' + userId + ', RC ID: ' + revenueCatId);

    // Opdater bruger til valgt tier
    await pool.query(
      'UPDATE users SET subscription_tier = $1, subscription_status = $2, revenuecat_id = $3 WHERE id = $4',
      [validTier, 'active', revenueCatId || null, userId]
    );

    console.log('[RevenueCat] User ' + userId + ' upgraded to ' + validTier);

    res.json({
      success: true,
      tier: validTier,
      message: 'Subscription aktiveret'
    });
  } catch (err) {
    console.error('Subscription activate error:', err);
    res.status(500).json({ error: 'Kunne ikke aktivere subscription' });
  }
});

// ─── GET USER TIER + FEATURE FLAGS ────────────────────────────────
app.get('/users/me/tier', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const result = await pool.query(
      'SELECT subscription_tier, subscription_status FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const row = result.rows[0];
    const status = row.subscription_status;
    const rawTier = row.subscription_tier || 'free';

    // If subscription is not active, treat as free
    const isActive = status === 'active' || status === 'trialing';
    const tier = isActive ? rawTier : 'free';

    const isPro = tier === 'pro';
    const isBasic = tier === 'basic' || isPro; // Pro inherits Basic
    const isFree = tier === 'free';

    res.json({
      tier,
      isPro,
      isBasic,
      isFree,
      weeklyActivityLimit: isFree ? 3 : null,
      canUseMealTracking: isPro,
      canUseMealPlan: isPro,
      canUseAICoach: isBasic,
      canUseAllActivities: isBasic
    });
  } catch (err) {
    console.error('Get tier error:', err);
    res.status(500).json({ error: 'Kunne ikke hente tier' });
  }
});

// â”€â”€â”€ APPLE IAP RECEIPT VALIDATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/validate-receipt', authMiddleware, async (req, res) => {
  try {
    const { receipt, productId } = req.body;

    if (!receipt) {
      return res.status(400).json({ error: 'Receipt pÃ¥krÃ¦vet' });
    }

    // Validate receipt with Apple
    const verifyUrl = process.env.NODE_ENV === 'production'
      ? 'https://buy.itunes.apple.com/verifyReceipt'
      : 'https://sandbox.itunes.apple.com/verifyReceipt';

    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'receipt-data': receipt,
        'password': process.env.APPLE_SHARED_SECRET,
        'exclude-old-transactions': true,
      }),
    });

    const data = await response.json();

    // Status 21007 means sandbox receipt sent to production - retry with sandbox
    if (data.status === 21007) {
      const sandboxResponse = await fetch('https://sandbox.itunes.apple.com/verifyReceipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          'receipt-data': receipt,
          'password': process.env.APPLE_SHARED_SECRET,
          'exclude-old-transactions': true,
        }),
      });
      const sandboxData = await sandboxResponse.json();
      
      if (sandboxData.status !== 0) {
        console.error('Apple receipt validation failed (sandbox):', sandboxData.status);
        return res.status(400).json({ error: 'Ugyldig kvittering', status: sandboxData.status });
      }
      
      // Process sandbox receipt
      return processAppleReceipt(sandboxData, req.userId, res);
    }

    if (data.status !== 0) {
      console.error('Apple receipt validation failed:', data.status);
      return res.status(400).json({ error: 'Ugyldig kvittering', status: data.status });
    }

    return processAppleReceipt(data, req.userId, res);

  } catch (err) {
    console.error('Apple receipt validation error:', err);
    res.status(500).json({ error: 'Kunne ikke validere kÃ¸b' });
  }
});

async function processAppleReceipt(data, userId, res) {
  try {
    const latestReceipt = data.latest_receipt_info;
    
    if (!latestReceipt || latestReceipt.length === 0) {
      return res.status(400).json({ error: 'Ingen aktiv subscription fundet' });
    }

    // Find the most recent subscription
    const sortedReceipts = latestReceipt.sort((a, b) => 
      parseInt(b.expires_date_ms) - parseInt(a.expires_date_ms)
    );
    const activeReceipt = sortedReceipts[0];

    const expiresAt = new Date(parseInt(activeReceipt.expires_date_ms));
    const isActive = expiresAt > new Date();

    if (isActive) {
      // Update user to Pro
      await pool.query(`
        UPDATE users 
        SET subscription_tier = 'pro',
            subscription_status = 'active',
            subscription_ends_at = $1,
            apple_original_transaction_id = $2
        WHERE id = $3
      `, [expiresAt, activeReceipt.original_transaction_id, userId]);

      console.log(`[APPLE IAP] User ${userId} upgraded to Pro, expires: ${expiresAt}`);
      return res.json({ success: true, tier: 'pro', expiresAt });
    } else {
      return res.status(400).json({ error: 'Subscription er udlÃ¸bet' });
    }
  } catch (err) {
    console.error('Process Apple receipt error:', err);
    return res.status(500).json({ error: 'Kunne ikke behandle kvittering' });
  }
}

// â”€â”€â”€ RESTORE APPLE PURCHASES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/restore-purchases', authMiddleware, async (req, res) => {
  try {
    const { purchases } = req.body;

    if (!purchases || purchases.length === 0) {
      return res.json({ success: false, hasActiveSub: false });
    }

    // Find active subscription among restored purchases
    let hasActiveSub = false;
    let latestExpiry = null;

    for (const purchase of purchases) {
      if (purchase.transactionReceipt) {
        // Validate each receipt
        const verifyUrl = process.env.NODE_ENV === 'production'
          ? 'https://buy.itunes.apple.com/verifyReceipt'
          : 'https://sandbox.itunes.apple.com/verifyReceipt';

        const response = await fetch(verifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            'receipt-data': purchase.transactionReceipt,
            'password': process.env.APPLE_SHARED_SECRET,
            'exclude-old-transactions': true,
          }),
        });

        let data = await response.json();

        // Retry with sandbox if needed
        if (data.status === 21007) {
          const sandboxResponse = await fetch('https://sandbox.itunes.apple.com/verifyReceipt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              'receipt-data': purchase.transactionReceipt,
              'password': process.env.APPLE_SHARED_SECRET,
              'exclude-old-transactions': true,
            }),
          });
          data = await sandboxResponse.json();
        }

        if (data.status === 0 && data.latest_receipt_info) {
          const sortedReceipts = data.latest_receipt_info.sort((a, b) => 
            parseInt(b.expires_date_ms) - parseInt(a.expires_date_ms)
          );
          const activeReceipt = sortedReceipts[0];
          const expiresAt = new Date(parseInt(activeReceipt.expires_date_ms));

          if (expiresAt > new Date()) {
            hasActiveSub = true;
            if (!latestExpiry || expiresAt > latestExpiry) {
              latestExpiry = expiresAt;

              // Update user to Pro
              await pool.query(`
                UPDATE users 
                SET subscription_tier = 'pro',
                    subscription_status = 'active',
                    subscription_ends_at = $1,
                    apple_original_transaction_id = $2
                WHERE id = $3
              `, [expiresAt, activeReceipt.original_transaction_id, req.userId]);
            }
          }
        }
      }
    }

    if (hasActiveSub) {
      console.log(`[APPLE IAP] User ${req.userId} restored Pro subscription`);
    }

    res.json({ success: true, hasActiveSub, expiresAt: latestExpiry });
  } catch (err) {
    console.error('Restore purchases error:', err);
    res.status(500).json({ error: 'Kunne ikke gendanne kÃ¸b' });
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
    res.status(500).json({ error: 'Kunne ikke Ã¥bne kundeportal' });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// RUNS ENDPOINTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.get('/runs', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM runs WHERE user_id = $1 ORDER BY date DESC',
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get runs error:', err);
    res.status(500).json({ error: 'Kunne ikke hente lÃ¸b' });
  }
});

app.post('/runs', authMiddleware, async (req, res) => {
  try {
    const limitCheck = await checkActivityLimit(req.userId);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: 'limit_exceeded',
        message: 'Du har naaet graensen paa 3 aktiviteter/uge paa Free. Opgrader til Basic eller Pro for ubegraenset.',
        count: limitCheck.count,
        limit: limitCheck.limit
      });
    }
    const run = req.body;
    const result = await pool.query(`
      INSERT INTO runs (user_id, date, km, duration, pace, calories, heart_rate, route, notes, type, created_at, running_km, walking_km, max_hr, cadence, total_ascent, total_descent, total_steps, splits, hr_samples)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
      run.type || 'run',
      run.running_km || null,
      run.walking_km || null,
      run.max_hr || null,
      run.cadence || null,
      run.total_ascent || null,
      run.total_descent || null,
      run.total_steps || null,
      run.splits ? (typeof run.splits === "string" ? run.splits : JSON.stringify(run.splits)) : null,
      run.hr_samples ? (typeof run.hr_samples === "string" ? run.hr_samples : JSON.stringify(run.hr_samples)) : null
    ]);

    const savedRun = result.rows[0];

    // â”€â”€â”€ AUTO-LOG TO ACTIVE CHALLENGES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      await logChallengeActivity(req.userId, savedRun.id, savedRun.km, savedRun.date);
    } catch (chalErr) {
      console.warn('Challenge auto-log warning (run still saved):', chalErr.message);
    }

    res.json(savedRun);
  } catch (err) {
    console.error('Save run error:', err);
    res.status(500).json({ error: 'Kunne ikke gemme lÃ¸b' });
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
      return res.status(404).json({ error: 'LÃ¸b ikke fundet' });
    }
    res.json({ success: true, deletedId: result.rows[0].id });
  } catch (err) {
    console.error('Delete run error:', err);
    res.status(500).json({ error: 'Kunne ikke slette lÃ¸b' });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CHALLENGES & STREAKS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

// â”€â”€â”€ CREATE CHALLENGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/challenges', authMiddleware, async (req, res) => {
  try {
    const { title, description, type, target_value, target_period, end_date } = req.body;

    if (!title || !target_value) {
      return res.status(400).json({ error: 'Titel og mÃ¥l er pÃ¥krÃ¦vet' });
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

// â”€â”€â”€ GET MY CHALLENGES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ JOIN CHALLENGE BY INVITE CODE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/challenges/join', authMiddleware, async (req, res) => {
  try {
    const { invite_code } = req.body;

    if (!invite_code) {
      return res.status(400).json({ error: 'Invite-kode pÃ¥krÃ¦vet' });
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

// â”€â”€â”€ LOG ACTIVITY (manual â€“ auto-log happens in POST /runs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ GET CHALLENGE DETAILS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ LEAVE CHALLENGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PHOTO STORY ENDPOINTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€â”€ UPLOAD PHOTO DURING RUN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ GET PHOTOS FOR A RUN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ GENERATE AI STORY FROM RUN + PHOTOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    const userName = (typeof profileData === 'string' ? JSON.parse(profileData) : profileData)?.name || 'LÃ¸ber';

    const runData = run.rows[0];
    const km = parseFloat(runData.km || 0).toFixed(1);
    const duration = runData.duration || 'ukendt';
    const photoCount = photos.rows.length;

    // Build prompt for AI story
    const photoDescriptions = photos.rows.map((p, i) => {
      const time = new Date(p.taken_at).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
      return `Foto ${i + 1}: taget kl. ${time}${p.caption ? ` â€“ "${p.caption}"` : ''}${p.latitude ? ` (${parseFloat(p.latitude).toFixed(4)}, ${parseFloat(p.longitude).toFixed(4)})` : ''}`;
    }).join('\n');

    const prompt = `Du er en kreativ lÃ¸be-historiefortÃ¦ller for appen RunWithAI. Skriv en kort, engagerende lÃ¸be-story pÃ¥ dansk (max 200 ord) baseret pÃ¥ dette lÃ¸b:

LÃ¸ber: ${userName}
Distance: ${km} km
Varighed: ${duration}
Antal fotos: ${photoCount}
${photoDescriptions ? `\nFotos undervejs:\n${photoDescriptions}` : ''}

Skriv en livlig, motiverende fortÃ¦lling i 2. person ("du") der beskriver lÃ¸beturen som en eventyrlig rejse. Brug foto-tidspunkterne og eventuelle captions til at flette billederne naturligt ind i historien. TilfÃ¸j emoji hvor det passer. Afslut med en opmuntrende kommentar.

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

// â”€â”€â”€ GET EXISTING STORY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ SHARE STORY TO FEED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ GET SHARED STORIES FROM FRIENDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TRAINING PLAN ENDPOINTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.get('/trainingplan', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM training_plan WHERE user_id = $1 ORDER BY generated_at DESC LIMIT 1',
      [req.userId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('Get training plan error:', err);
    res.status(500).json({ error: 'Kunne ikke hente trÃ¦ningsplan' });
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
    res.status(500).json({ error: 'Kunne ikke gemme trÃ¦ningsplan' });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// WEEK PLAN ENDPOINTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TTS ENDPOINT (OpenAI gpt-4o-mini-tts â€“ natural voice with instructions)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.post('/tts', authMiddleware, async (req, res) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'TTS ikke konfigureret (mangler OpenAI API nÃ¸gle)' });
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
        instructions: 'Du er en venlig og energisk dansk lÃ¸becoach. Tal tydeligt og naturligt pÃ¥ dansk med et opmuntrende tonefald. Hold en rolig men motiverende stemme.',
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AI CHAT ENDPOINT (proxy to Anthropic API)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.post('/chat', authMiddleware, async (req, res) => {
  try {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'AI coach ikke konfigureret (mangler API nÃ¸gle)' });
    }
const { model, max_tokens, system, messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages er påkrævet og må ikke være tom' });
    }

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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MESSAGES ENDPOINTS (chat history)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FRIENDS ENDPOINTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€â”€ GET MY FRIENDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ SEND FRIEND REQUEST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/friends/request', authMiddleware, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email pÃ¥krÃ¦vet' });

    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bruger ikke fundet' });
    }

    const friendId = userResult.rows[0].id;
    if (friendId === req.userId) {
      return res.status(400).json({ error: 'Du kan ikke tilfÃ¸je dig selv' });
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

// â”€â”€â”€ RESPOND TO FRIEND REQUEST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    res.status(500).json({ error: 'Kunne ikke svare pÃ¥ anmodning' });
  }
});

// â”€â”€â”€ REMOVE FRIEND â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ FRIENDS FEED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// VOICE COACH ENDPOINT (Whisper transcription + AI response)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    const userName = (typeof profileData === 'string' ? JSON.parse(profileData) : profileData)?.name || 'lÃ¸ber';

    // Parse run context
    let runContext = {};
    try {
      if (req.body.context) runContext = JSON.parse(req.body.context);
    } catch {}

    // â”€â”€â”€ Step 1: Transcribe with Whisper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      return res.json({ text: 'Jeg hÃ¸rte dig ikke helt, prÃ¸v igen.', transcription: '' });
    }

    // â”€â”€â”€ Step 2: AI Coach response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const kmStr = runContext.km ? `${runContext.km.toFixed(1)} km` : 'ukendt';
    const paceStr = runContext.pace ? `${Math.floor(runContext.pace)}:${String(Math.round((runContext.pace % 1) * 60)).padStart(2, '0')} min/km` : 'ukendt';
    const durationMins = runContext.duration ? Math.floor(runContext.duration / 60) : 0;

    const systemPrompt = `Du er en venlig og energisk dansk lÃ¸becoach i appen RunWithAI. Brugeren hedder ${userName} og er midt i et lÃ¸b.

Aktuelle lÃ¸bdata:
- Distance: ${kmStr}
- Pace: ${paceStr}
- Tid: ${durationMins} minutter

Regler:
- Svar KORT (max 2-3 sÃ¦tninger) â€“ brugeren lÃ¸ber og kan ikke lÃ¦se lange svar
- VÃ¦r opmuntrende og positiv
- Svar pÃ¥ dansk
- Hvis de spÃ¸rger om deres tempo/distance, brug de aktuelle data
- Hvis de beder om motivation, giv en kort energisk peptalk
- Hvis de vil vide noget om lÃ¸b/trÃ¦ning, giv et kort svar`;

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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ROOT ENDPOINT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.get('/', (req, res) => {
  res.json({ status: 'RunWithAI server kÃ¸rer!', version: '3.0.1-revenuecat' });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// START SERVER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MULTI-ACTIVITY ENDPOINTS (v2 - activities, exercises, goals)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€â”€ ACTIVITIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// GET /activities - Hent alle aktiviteter for brugeren
app.get('/activities', authMiddleware, async (req, res) => {
  try {
    const { type, limit } = req.query;
    let query =
      'SELECT a.*, ' +
      '  rd.distance_m AS run_distance_m, rd.avg_pace_sec_per_km, rd.total_ascent_m AS run_ascent_m, ' +
      '  rd.total_descent_m AS run_descent_m, rd.total_steps, rd.cadence_avg, rd.splits AS run_splits, ' +
      '  rd.hr_samples AS run_hr_samples, rd.gps_polyline AS run_gps_polyline, ' +
      '  bd.distance_m AS bike_distance_m, bd.avg_speed_kmh, bd.max_speed_kmh, ' +
      '  bd.total_ascent_m AS bike_ascent_m, bd.total_descent_m AS bike_descent_m, ' +
      '  bd.splits AS bike_splits, bd.hr_samples AS bike_hr_samples, bd.gps_polyline AS bike_gps_polyline ' +
      'FROM activities a ' +
      'LEFT JOIN activity_run_details rd ON rd.activity_id = a.id ' +
      'LEFT JOIN activity_bike_details bd ON bd.activity_id = a.id ' +
      'WHERE a.user_id = $1';
    const params = [req.userId];
    if (type) {
      query += ' AND a.type = $2';
      params.push(type);
    }
    query += ' ORDER BY a.started_at DESC';
    if (limit) {
      query += ' LIMIT $' + (params.length + 1);
      params.push(parseInt(limit, 10));
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get activities error:', err);
    res.status(500).json({ error: 'Kunne ikke hente aktiviteter' });
  }
});

// POST /activities - Opret en ny aktivitet (med detail-tabel for run/bike)
app.post('/activities', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try { 
    const limitCheck = await checkActivityLimit(req.userId);
    if (!limitCheck.allowed) {
      client.release();
      return res.status(403).json({
        error: 'limit_exceeded',
        message: 'Du har naaet graensen paa 3 aktiviteter/uge paa Free. Opgrader til Basic eller Pro for ubegraenset.',
        count: limitCheck.count,
        limit: limitCheck.limit
      });
    }
    const a = req.body;
    const validTypes = ['run', 'walk', 'bike', 'strength', 'mobility', 'other'];
    if (!a.type || !validTypes.includes(a.type)) {
      return res.status(400).json({ error: 'Ugyldig aktivitetstype' });
    }
    if (!a.started_at) {
      return res.status(400).json({ error: 'started_at er paakraevet' });
    }

    await client.query('BEGIN');

    const actResult = await client.query(
      'INSERT INTO activities (user_id, type, started_at, duration_sec, calories_kcal, avg_hr, max_hr, perceived_effort, notes, source) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
      [
        req.userId,
        a.type,
        a.started_at,
        a.duration_sec || null,
        a.calories_kcal || null,
        a.avg_hr || null,
        a.max_hr || null,
        a.perceived_effort || null,
        a.notes || null,
        a.source || 'manual'
      ]
    );
    const activity = actResult.rows[0];

    // Bike-specifikke detaljer
    if (a.type === 'bike' && (a.distance_m || a.avg_speed_kmh || a.gps_polyline)) {
      await client.query(
        'INSERT INTO activity_bike_details (activity_id, distance_m, avg_speed_kmh, max_speed_kmh, total_ascent_m, total_descent_m, splits, hr_samples, gps_polyline) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          activity.id,
          a.distance_m || null,
          a.avg_speed_kmh || null,
          a.max_speed_kmh || null,
          a.total_ascent_m || null,
          a.total_descent_m || null,
          a.splits ? JSON.stringify(a.splits) : null,
          a.hr_samples ? JSON.stringify(a.hr_samples) : null,
          a.gps_polyline || null
        ]
      );
    }

    // Run-specifikke detaljer
    if (a.type === 'run' && (a.distance_m || a.avg_pace_sec_per_km || a.gps_polyline)) {
      await client.query(
        'INSERT INTO activity_run_details (activity_id, distance_m, avg_pace_sec_per_km, total_ascent_m, total_descent_m, total_steps, cadence_avg, splits, hr_samples, gps_polyline) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [
          activity.id,
          a.distance_m || null,
          a.avg_pace_sec_per_km || null,
          a.total_ascent_m || null,
          a.total_descent_m || null,
          a.total_steps || null,
          a.cadence_avg || null,
          a.splits ? JSON.stringify(a.splits) : null,
          a.hr_samples ? JSON.stringify(a.hr_samples) : null,
          a.gps_polyline || null
        ]
      );
    }

    await client.query('COMMIT');
    res.json(activity);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create activity error:', err);
    res.status(500).json({ error: 'Kunne ikke gemme aktivitet' });
  } finally {
    client.release();
  }
});

// â”€â”€â”€ EXERCISES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// GET /exercises - Hent alle tilgÃ¦ngelige Ã¸velser (offentlige + brugerens egne)
app.get('/exercises', authMiddleware, async (req, res) => {
  try {
    const { category, muscle_group } = req.query;
    let query = 'SELECT * FROM exercises WHERE is_custom = false OR created_by = $1';
    const params = [req.userId];

    if (category) {
      query += ' AND category = $' + (params.length + 1);
      params.push(category);
    }
    if (muscle_group) {
      query += ' AND $' + (params.length + 1) + ' = ANY(muscle_groups)';
      params.push(muscle_group);
    }

    query += ' ORDER BY name ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get exercises error:', err);
    res.status(500).json({ error: 'Kunne ikke hente Ã¸velser' });
  }
});

// â”€â”€â”€ GOALS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// GET /goals - Hent brugerens mÃ¥l (eller null hvis ingen er sat endnu)
app.get('/goals', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM user_goals WHERE user_id = $1',
      [req.userId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('Get goals error:', err);
    res.status(500).json({ error: 'Kunne ikke hente mÃ¥l' });
  }
});

// PUT /goals - Opret eller opdatÃ©r brugerens mÃ¥l
app.put('/goals', authMiddleware, async (req, res) => {
  try {
    const g = req.body;
    const validGoals = ['lose_fat', 'gain_muscle', 'run_faster', 'run_longer', 'maintain'];
    if (g.primary_goal && !validGoals.includes(g.primary_goal)) {
      return res.status(400).json({ error: 'Ugyldigt mÃ¥l' });
    }
    const result = await pool.query(
      'INSERT INTO user_goals (user_id, primary_goal, target_weight_kg, target_kcal, target_protein_g, target_carbs_g, target_fat_g, weekly_run_km, weekly_strength_sessions, race_date, race_distance_km, updated_at) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) ' +
      'ON CONFLICT (user_id) DO UPDATE SET ' +
      '  primary_goal = EXCLUDED.primary_goal, ' +
      '  target_weight_kg = EXCLUDED.target_weight_kg, ' +
      '  target_kcal = EXCLUDED.target_kcal, ' +
      '  target_protein_g = EXCLUDED.target_protein_g, ' +
      '  target_carbs_g = EXCLUDED.target_carbs_g, ' +
      '  target_fat_g = EXCLUDED.target_fat_g, ' +
      '  weekly_run_km = EXCLUDED.weekly_run_km, ' +
      '  weekly_strength_sessions = EXCLUDED.weekly_strength_sessions, ' +
      '  race_date = EXCLUDED.race_date, ' +
      '  race_distance_km = EXCLUDED.race_distance_km, ' +
      '  updated_at = NOW() ' +
      'RETURNING *',
      [
        req.userId,
        g.primary_goal || null,
        g.target_weight_kg || null,
        g.target_kcal || null,
        g.target_protein_g || null,
        g.target_carbs_g || null,
        g.target_fat_g || null,
        g.weekly_run_km || null,
        g.weekly_strength_sessions || null,
        g.race_date || null,
        g.race_distance_km || null
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update goals error:', err);
    res.status(500).json({ error: 'Kunne ikke gemme mÃ¥l' });
  }
});
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// NUTRITION ENDPOINTS (v2 - meals, foods, daily summary)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€â”€ MEALS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// GET /meals?date=YYYY-MM-DD - Hent mÃ¥ltider for en bestemt dag (default: i dag)
app.get('/meals', authMiddleware, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      'SELECT m.*, ' +
      '  COALESCE(json_agg(json_build_object(' +
      '    \'id\', mi.id, \'food_id\', mi.food_id, \'amount_g\', mi.amount_g, ' +
      '    \'kcal\', mi.kcal, \'protein_g\', mi.protein_g, \'carbs_g\', mi.carbs_g, \'fat_g\', mi.fat_g, ' +
      '    \'food_name\', f.name, \'food_brand\', f.brand' +
      '  )) FILTER (WHERE mi.id IS NOT NULL), \'[]\') AS items ' +
      'FROM meals m ' +
      'LEFT JOIN meal_items mi ON mi.meal_id = m.id ' +
      'LEFT JOIN foods f ON f.id = mi.food_id ' +
      'WHERE m.user_id = $1 AND DATE(m.eaten_at) = $2 ' +
      'GROUP BY m.id ' +
      'ORDER BY m.eaten_at ASC',
      [req.userId, date]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Get meals error:', err);
    res.status(500).json({ error: 'Kunne ikke hente mÃ¥ltider' });
  }
});

// POST /meals - Log et nyt mÃ¥ltid med items
// Body: { eaten_at, meal_type, notes, items: [{ food_id?, amount_g, kcal, protein_g, carbs_g, fat_g }] }
app.post('/meals', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const m = req.body;

    if (!m.eaten_at) {
      return res.status(400).json({ error: 'eaten_at er pÃ¥krÃ¦vet' });
    }
    if (!Array.isArray(m.items) || m.items.length === 0) {
      return res.status(400).json({ error: 'items er pÃ¥krÃ¦vet (mindst Ã©t item)' });
    }

    const validTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
    if (m.meal_type && !validTypes.includes(m.meal_type)) {
      return res.status(400).json({ error: 'Ugyldig meal_type' });
    }

    await client.query('BEGIN');

    const mealResult = await client.query(
      'INSERT INTO meals (user_id, eaten_at, meal_type, notes, photo_url) ' +
      'VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.userId, m.eaten_at, m.meal_type || null, m.notes || null, m.photo_url || null]
    );
    const meal = mealResult.rows[0];

    const insertedItems = [];
    for (const item of m.items) {
      if (!item.amount_g || item.kcal === undefined) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Hvert item skal have amount_g og kcal' });
      }
      const itemResult = await client.query(
        'INSERT INTO meal_items (meal_id, food_id, amount_g, kcal, protein_g, carbs_g, fat_g) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [
          meal.id,
          item.food_id || null,
          item.amount_g,
          item.kcal,
          item.protein_g || 0,
          item.carbs_g || 0,
          item.fat_g || 0
        ]
      );
      insertedItems.push(itemResult.rows[0]);
    }

    await client.query('COMMIT');
    meal.items = insertedItems;
    res.json(meal);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create meal error:', err);
    res.status(500).json({ error: 'Kunne ikke gemme mÃ¥ltid' });
  } finally {
    client.release();
  }
});

// DELETE /meals/:id - Slet et mÃ¥ltid (kun eget)
app.delete('/meals/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM meals WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'MÃ¥ltid ikke fundet' });
    }
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Delete meal error:', err);
    res.status(500).json({ error: 'Kunne ikke slette mÃ¥ltid' });
  }
});

// â”€â”€â”€ FOODS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// GET /foods/search?q=... - Søg i food database (lokal cache + Open Food Facts fallback)
app.get('/foods/search', authMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.json([]);
    }

    // Step 1: Sog i lokal cache
    const localResult = await pool.query(
      'SELECT * FROM foods WHERE LOWER(name) LIKE $1 OR LOWER(brand) LIKE $1 ORDER BY is_verified DESC, name ASC LIMIT 50',
      ['%' + q.toLowerCase() + '%']
    );
    const localRows = localResult.rows;

    // Hvis vi har mindst 5 lokale resultater, returner dem (ingen OFF-kald)
    if (localRows.length >= 5) {
      return res.json(localRows);
    }

    // Step 2: Fallback til Open Food Facts navne-sogning (DK-prioriteret)
    let offRows = [];
    try {
      const offUrl = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' +
        encodeURIComponent(q) +
        '&search_simple=1&action=process&json=1&page_size=25&countries_tags_en=denmark';
      const offRes = await fetch(offUrl, {
        headers: { 'User-Agent': 'RunWithAI/1.0 (https://runwithai.app)' }
      });
      if (offRes.ok) {
        const offData = await offRes.json();
        const products = (offData.products || []).filter(function (p) {
          const n = p.nutriments || {};
          return n['energy-kcal_100g'] !== undefined && (p.product_name || p.generic_name);
        });

        // Cache de relevante produkter (max 10) i lokal foods tabel
        const toCache = products.slice(0, 10);
        for (let i = 0; i < toCache.length; i++) {
          const p = toCache[i];
          const n = p.nutriments || {};
          const code = p.code || p._id;
          if (!code) continue;
          try {
            const cached = await pool.query(
              'INSERT INTO foods (source, source_id, name, brand, serving_size_g, kcal_per_100g, protein_g, carbs_g, fat_g, fiber_g, is_verified) ' +
              'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ' +
              'ON CONFLICT (source, source_id) DO UPDATE SET ' +
              '  name = EXCLUDED.name, brand = EXCLUDED.brand, kcal_per_100g = EXCLUDED.kcal_per_100g ' +
              'RETURNING *',
              [
                'openfoodfacts',
                code,
                p.product_name || p.generic_name || 'Ukendt produkt',
                p.brands || null,
                p.serving_quantity ? parseFloat(p.serving_quantity) : null,
                n['energy-kcal_100g'] || 0,
                n.proteins_100g || 0,
                n.carbohydrates_100g || 0,
                n.fat_100g || 0,
                n.fiber_100g || null,
                false
              ]
            );
            offRows.push(cached.rows[0]);
          } catch (cacheErr) {
            console.error('Cache OFF product error:', cacheErr.message);
          }
        }
      }
    } catch (offErr) {
      console.error('OFF search error:', offErr.message);
    }

    // Kombiner: lokale forst, derefter OFF-resultater (uden duplicates)
    const seen = new Set(localRows.map(function (r) { return r.id; }));
    const combined = localRows.slice();
    for (let i = 0; i < offRows.length; i++) {
      if (!seen.has(offRows[i].id)) {
        combined.push(offRows[i]);
        seen.add(offRows[i].id);
      }
    }

    res.json(combined);
  } catch (err) {
    console.error('Search foods error:', err);
    res.status(500).json({ error: 'Kunne ikke soge i foedevarer' });
  }
});

// GET /foods/barcode/:ean - SlÃ¥ produkt op via stregkode (Open Food Facts)
app.get('/foods/barcode/:ean', authMiddleware, async (req, res) => {
  try {
    const ean = req.params.ean.replace(/[^0-9]/g, '');
    if (ean.length < 8) {
      return res.status(400).json({ error: 'Ugyldig stregkode' });
    }

    // Tjek fÃ¸rst lokal cache
    const cached = await pool.query(
      "SELECT * FROM foods WHERE source = 'openfoodfacts' AND source_id = $1",
      [ean]
    );
    if (cached.rows.length > 0) {
      return res.json(cached.rows[0]);
    }

    // Hent fra Open Food Facts
    const off = await fetch('https://world.openfoodfacts.org/api/v2/product/' + ean + '.json');
    if (!off.ok) {
      return res.status(404).json({ error: 'Produkt ikke fundet' });
    }
    const data = await off.json();
    if (data.status !== 1 || !data.product) {
      return res.status(404).json({ error: 'Produkt ikke fundet' });
    }

    const p = data.product;
    const nutriments = p.nutriments || {};

    if (nutriments['energy-kcal_100g'] === undefined) {
      return res.status(404).json({ error: 'ErnÃ¦ringsdata mangler for dette produkt' });
    }

    // Cache i vores database
    const inserted = await pool.query(
      'INSERT INTO foods (source, source_id, name, brand, serving_size_g, kcal_per_100g, protein_g, carbs_g, fat_g, fiber_g, is_verified) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ' +
      'ON CONFLICT (source, source_id) DO UPDATE SET ' +
      '  name = EXCLUDED.name, brand = EXCLUDED.brand, kcal_per_100g = EXCLUDED.kcal_per_100g ' +
      'RETURNING *',
      [
        'openfoodfacts',
        ean,
        p.product_name || p.generic_name || 'Ukendt produkt',
        p.brands || null,
        p.serving_quantity ? parseFloat(p.serving_quantity) : null,
        nutriments['energy-kcal_100g'] || 0,
        nutriments.proteins_100g || 0,
        nutriments.carbohydrates_100g || 0,
        nutriments.fat_100g || 0,
        nutriments.fiber_100g || null,
        false
      ]
    );

    res.json(inserted.rows[0]);
  } catch (err) {
    console.error('Barcode lookup error:', err);
    res.status(500).json({ error: 'Kunne ikke slÃ¥ stregkode op' });
  }
});

// POST /foods/analyze-photo - AI-analyse af madbillede via Claude Vision
app.post('/foods/analyze-photo', authMiddleware, async (req, res) => {
  try {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'AI ikke konfigureret' });
    }

    const { image_base64, image_media_type } = req.body;
    if (!image_base64) {
      return res.status(400).json({ error: 'image_base64 er paakraevet' });
    }

    const mediaType = image_media_type || 'image/jpeg';

    const systemPrompt = 'Du er en ernaeringsekspert der analyserer madbilleder. Returner ALTID kun gyldig JSON uden markdown eller forklaring. JSON skal have feltet "items" som er en array af objekter med felterne: name (dansk navn), estimated_grams (tal), kcal_per_100g (tal), protein_g (per 100g, tal), carbs_g (per 100g, tal), fat_g (per 100g, tal), confidence (0-1). Estimer maengder ud fra hvad du ser paa tallerkenen/glasset.';

    const userPrompt = 'Analyser dette billede og identificer alle madvarer. Returner kun JSON.';

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image_base64 } },
            { type: 'text', text: userPrompt }
          ]
        }],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      console.error('Anthropic vision error:', data);
      return res.status(anthropicRes.status).json({ error: 'AI fejl', details: data });
    }

    const textBlock = (data.content || []).find(b => b.type === 'text');
    const rawText = textBlock ? textBlock.text : '';

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { items: [] };
    } catch (e) {
      console.error('JSON parse error:', e, 'Raw:', rawText);
      return res.status(500).json({ error: 'AI svar kunne ikke parses', raw: rawText });
    }

    res.json({ items: parsed.items || [], raw: rawText });
  } catch (err) {
    console.error('analyze-photo error:', err);
    res.status(500).json({ error: 'Foto-analyse fejlede' });
  }
});
// POST /foods/custom - Opret egen mad (custom food)
app.post('/foods/custom', authMiddleware, async (req, res) => {
  try {
    const f = req.body;
    if (!f.name || f.kcal_per_100g === undefined) {
      return res.status(400).json({ error: 'name og kcal_per_100g er pÃ¥krÃ¦vet' });
    }
    const result = await pool.query(
      'INSERT INTO foods (source, source_id, name, brand, serving_size_g, kcal_per_100g, protein_g, carbs_g, fat_g, fiber_g, is_verified) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false) RETURNING *',
      [
        'custom',
        'user_' + req.userId + '_' + Date.now(),
        f.name,
        f.brand || null,
        f.serving_size_g || null,
        f.kcal_per_100g,
        f.protein_g || 0,
        f.carbs_g || 0,
        f.fat_g || 0,
        f.fiber_g || null
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Create custom food error:', err);
    res.status(500).json({ error: 'Kunne ikke gemme fÃ¸devare' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// LIFESUM-STYLE CALORIE CALCULATION (BMR + TDEE + målbaseret justering)
// ═══════════════════════════════════════════════════════════════════════════

// Aktivitetsfaktorer (matcher Lifesum's 5 niveauer)
const ACTIVITY_FACTORS = {
  sedentary:   1.2,
  light:       1.375,
  moderate:    1.55,
  active:      1.725,
  very_active: 1.9,
};

// Justering pr. mål og takt (kcal/dag i forhold til vedligehold)
const GOAL_ADJUSTMENTS = {
  lose_fat:    { slow: -250, normal: -500, fast: -750 },
  maintain:    { slow:    0, normal:    0, fast:    0 },
  gain_muscle: { slow: +250, normal: +400, fast: +500 },
};

// Makro-fordelinger (% af kcal: protein / kulhydrat / fedt)
const MACRO_PLANS = {
  balanced:     { protein: 0.25, carbs: 0.50, fat: 0.25 },
  high_protein: { protein: 0.35, carbs: 0.40, fat: 0.25 },
  low_carb:     { protein: 0.30, carbs: 0.25, fat: 0.45 },
  keto:         { protein: 0.25, carbs: 0.05, fat: 0.70 },
};

// Mifflin-St Jeor BMR
function calculateBMR({ weight_kg, height_cm, age, gender }) {
  if (!weight_kg || !height_cm || !age || !gender) return null;
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  return gender === 'female' ? base - 161 : base + 5;
}

// Beregn TDEE og daglige kcal/makro-mål
function calculateTargets(input) {
  const {
    weight_kg, height_cm, age, gender,
    activity_level, primary_goal, goal_pace, plan_type, target_weight_kg
  } = input || {};

  const bmr = calculateBMR({ weight_kg, height_cm, age, gender });
  if (!bmr) return null;

  const factor = ACTIVITY_FACTORS[activity_level] || ACTIVITY_FACTORS.moderate;
  const tdee = Math.round(bmr * factor);

  let goal = primary_goal || 'maintain';
  if (target_weight_kg && weight_kg) {
    if (target_weight_kg < weight_kg - 1) goal = 'lose_fat';
    else if (target_weight_kg > weight_kg + 1) goal = 'gain_muscle';
    else goal = 'maintain';
  }

  const pace = goal_pace || 'normal';
  const adjust = (GOAL_ADJUSTMENTS[goal] && GOAL_ADJUSTMENTS[goal][pace]) || 0;

  const minKcal = gender === 'female' ? 1200 : 1500;
  const targetKcal = Math.max(minKcal, tdee + adjust);

  const plan = MACRO_PLANS[plan_type] || MACRO_PLANS.balanced;
  const proteinG = Math.round((targetKcal * plan.protein) / 4);
  const carbsG   = Math.round((targetKcal * plan.carbs)   / 4);
  const fatG     = Math.round((targetKcal * plan.fat)     / 9);

  return {
    bmr_kcal: Math.round(bmr),
    tdee_kcal: tdee,
    target_kcal: targetKcal,
    target_protein_g: proteinG,
    target_carbs_g: carbsG,
    target_fat_g: fatG,
    primary_goal: goal,
    goal_pace: pace,
    plan_type: plan_type || 'balanced',
    activity_level: activity_level || 'moderate',
  };
}

// ─── POST /goals/calculate - preview uden at gemme ────────────────────────
app.post('/goals/calculate', authMiddleware, async (req, res) => {
  try {
    const result = calculateTargets(req.body || {});
    if (!result) {
      return res.status(400).json({ error: 'Mangler vægt, højde, alder eller køn' });
    }
    res.json(result);
  } catch (err) {
    console.error('Calculate goals error:', err);
    res.status(500).json({ error: 'Kunne ikke beregne mål' });
  }
});

// ─── POST /goals/auto - beregn fra profil + gem ───────────────────────────
app.post('/goals/auto', authMiddleware, async (req, res) => {
  try {
    const profileResult = await pool.query(
      'SELECT data FROM profile WHERE user_id = $1',
      [req.userId]
    );
    if (profileResult.rows.length === 0) {
      return res.status(400).json({ error: 'Profil mangler — udfyld vægt, højde, alder og køn først' });
    }
    let p = profileResult.rows[0].data;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) {} }
    p = p || {};

    const existingResult = await pool.query(
      'SELECT * FROM user_goals WHERE user_id = $1',
      [req.userId]
    );
    const existing = existingResult.rows[0] || {};

    // Map dansk sex til engelsk gender
    const sexMap = { 'Mand': 'male', 'Kvinde': 'female' };
    const mappedGender = p.gender || sexMap[p.sex] || p.sex;

    const input = {
      weight_kg: p.weight_kg || p.weight,
      height_cm: p.height_cm || p.height,
      age: p.age,
      gender: mappedGender,
      activity_level: req.body.activity_level || existing.activity_level || p.activity_level,
      primary_goal: req.body.primary_goal || existing.primary_goal,
      goal_pace: req.body.goal_pace || existing.goal_pace,
      plan_type: req.body.plan_type || existing.plan_type,
      target_weight_kg: req.body.target_weight_kg || existing.target_weight_kg,
    };

    const calc = calculateTargets(input);
    if (!calc) {
      return res.status(400).json({
        error: 'Profil mangler oplysninger',
        required: ['weight_kg', 'height_cm', 'age', 'gender'],
        have: {
          weight_kg: !!input.weight_kg,
          height_cm: !!input.height_cm,
          age: !!input.age,
          gender: !!input.gender,
        },
      });
    }

    const result = await pool.query(
      'INSERT INTO user_goals (user_id, primary_goal, target_weight_kg, target_kcal, target_protein_g, target_carbs_g, target_fat_g, plan_type, goal_pace, bmr_kcal, tdee_kcal, calculated_at, updated_at) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()) ' +
      'ON CONFLICT (user_id) DO UPDATE SET ' +
      '  primary_goal = EXCLUDED.primary_goal, ' +
      '  target_weight_kg = EXCLUDED.target_weight_kg, ' +
      '  target_kcal = EXCLUDED.target_kcal, ' +
      '  target_protein_g = EXCLUDED.target_protein_g, ' +
      '  target_carbs_g = EXCLUDED.target_carbs_g, ' +
      '  target_fat_g = EXCLUDED.target_fat_g, ' +
      '  plan_type = EXCLUDED.plan_type, ' +
      '  goal_pace = EXCLUDED.goal_pace, ' +
      '  bmr_kcal = EXCLUDED.bmr_kcal, ' +
      '  tdee_kcal = EXCLUDED.tdee_kcal, ' +
      '  calculated_at = NOW(), ' +
      '  updated_at = NOW() ' +
      'RETURNING *',
      [
        req.userId,
        calc.primary_goal,
        input.target_weight_kg || null,
        calc.target_kcal,
        calc.target_protein_g,
        calc.target_carbs_g,
        calc.target_fat_g,
        calc.plan_type,
        calc.goal_pace,
        calc.bmr_kcal,
        calc.tdee_kcal,
      ]
    );

    res.json({
      ...result.rows[0],
      calculation: {
        bmr_kcal: calc.bmr_kcal,
        tdee_kcal: calc.tdee_kcal,
        activity_level: calc.activity_level,
      },
    });
  } catch (err) {
    console.error('Auto-calculate goals error:', err);
    res.status(500).json({ error: 'Kunne ikke beregne mål' });
  }
});

// ─── DAILY SUMMARY ──────────────────────────────────────────────────────
// GET /daily-summary?date=YYYY-MM-DD - Hent dagens kalorie-balance
app.get('/daily-summary', authMiddleware, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    // Kalorier IND fra meals
    const kcalIn = await pool.query(
      'SELECT COALESCE(SUM(mi.kcal), 0) AS total, ' +
      '  COALESCE(SUM(mi.protein_g), 0) AS protein, ' +
      '  COALESCE(SUM(mi.carbs_g), 0) AS carbs, ' +
      '  COALESCE(SUM(mi.fat_g), 0) AS fat ' +
      'FROM meals m JOIN meal_items mi ON mi.meal_id = m.id ' +
      'WHERE m.user_id = $1 AND DATE(m.eaten_at) = $2',
      [req.userId, date]
    );

    // Kalorier UD fra activities-tabellen
    const kcalOutActivities = await pool.query(
      "SELECT COALESCE(SUM(calories_kcal), 0) AS total " +
      "FROM activities WHERE user_id = $1 AND DATE(started_at) = $2",
      [req.userId, date]
    );

    // Kalorier UD fra runs-tabellen (NYT — det her var bug'en)
    const kcalOutRuns = await pool.query(
      "SELECT COALESCE(SUM(calories), 0) AS total " +
      "FROM runs WHERE user_id = $1 AND DATE(date) = $2",
      [req.userId, date]
    );

    const kcalOutTotal =
      parseInt(kcalOutActivities.rows[0].total, 10) +
      parseInt(kcalOutRuns.rows[0].total, 10);

    // Hent brugerens mål (inkl. carbs + fat)
    const goals = await pool.query(
      'SELECT target_kcal, target_protein_g, target_carbs_g, target_fat_g ' +
      'FROM user_goals WHERE user_id = $1',
      [req.userId]
    );
    const target = goals.rows[0] || {
      target_kcal: null,
      target_protein_g: null,
      target_carbs_g: null,
      target_fat_g: null,
    };

    const kcalInTotal = parseInt(kcalIn.rows[0].total, 10);

    res.json({
      date: date,
      kcal_in: kcalInTotal,
      kcal_out_activity: kcalOutTotal,
      protein_g: parseFloat(kcalIn.rows[0].protein),
      carbs_g: parseFloat(kcalIn.rows[0].carbs),
      fat_g: parseFloat(kcalIn.rows[0].fat),
      target_kcal: target.target_kcal,
      target_protein_g: target.target_protein_g,
      target_carbs_g: target.target_carbs_g,
      target_fat_g: target.target_fat_g,
      // Lifesum-style: tilbage = mål + forbrændt − spist
      kcal_remaining: target.target_kcal
        ? (target.target_kcal + kcalOutTotal - kcalInTotal)
        : null,
    });
  } catch (err) {
    console.error('Daily summary error:', err);
    res.status(500).json({ error: 'Kunne ikke hente dagsoversigt' });
  }
});

registerStrengthEndpoints(app, pool, authMiddleware);
registerMealPlanEndpoints(app, pool, authMiddleware);
app.listen(PORT, () => {
  console.log(`ðŸƒ RunWithAI server kÃ¸rer pÃ¥ port ${PORT}`);
  console.log(`ðŸ“¦ Version: 3.0.1-revenuecat`);
});
