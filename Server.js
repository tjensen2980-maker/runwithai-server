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
      status,
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

// === GET CURRENT USER (email + profile basics) ===
app.get('/users/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, subscription_tier, subscription_status FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Kunne ikke hente bruger' });
  }
});

// === UPDATE USER EMAIL (kraever password-bekraeftelse) ===
app.put('/users/me/email', authMiddleware, async (req, res) => {
  try {
    const { newEmail, password } = req.body;
    if (!newEmail || !password) {
      return res.status(400).json({ error: 'newEmail og password er paakraevet' });
    }
    const emailLower = String(newEmail).toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailLower)) {
      return res.status(400).json({ error: 'Ugyldig email' });
    }
    // Hent nuvaerende bruger
    const userRes = await pool.query('SELECT id, email, password FROM users WHERE id = $1', [req.userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userRes.rows[0];
    // Verificer password
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Forkert password' });
    // Tjek om ny email allerede er taget
    if (emailLower !== user.email) {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [emailLower]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email er allerede i brug' });
      }
    }
    // Opdater email
    await pool.query('UPDATE users SET email = $1 WHERE id = $2', [emailLower, req.userId]);
    res.json({ success: true, email: emailLower });
  } catch (err) {
    console.error('Update email error:', err);
    res.status(500).json({ error: 'Kunne ikke opdatere email' });
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

// DELETE a single activity (bike/multi-activity) - only own activities
app.delete('/activities/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM activities WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
      );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Aktivitet ikke fundet' });
    }
    res.json({ success: true, deletedId: result.rows[0].id });
  } catch (err) {
    console.error('Delete activity error:', err);
    res.status(500).json({ error: 'Kunne ikke slette aktivitet' });
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
// POST /activities/sync-healthkit - Sync workouts fra Apple HealthKit
app.post('/activities/sync-healthkit', authMiddleware, async (req, res) => {
  try {
    const { workouts } = req.body;
    if (!Array.isArray(workouts)) {
      return res.status(400).json({ error: 'workouts skal vaere et array' });
    }

    // Map HealthKit activity type -> vores types
    const typeMap = {
      'HKWorkoutActivityTypeRunning': 'run',
      'Running': 'run',
      'HKWorkoutActivityTypeWalking': 'walk',
      'Walking': 'walk',
      'HKWorkoutActivityTypeCycling': 'bike',
      'Cycling': 'bike',
      'HKWorkoutActivityTypeTraditionalStrengthTraining': 'strength',
      'TraditionalStrengthTraining': 'strength',
      'HKWorkoutActivityTypeYoga': 'mobility',
      'Yoga': 'mobility',
    };

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const w of workouts) {
      try {
        if (!w.uuid || !w.start) {
          skipped++;
          continue;
        }

        const externalId = 'hk_' + w.uuid;
        const mappedType = typeMap[w.activityName] || typeMap[w.type] || 'other';

        // Tjek om allerede synket
        const existing = await pool.query(
          'SELECT id FROM activities WHERE user_id = $1 AND external_id = $2',
          [req.userId, externalId]
        );
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        const duration = w.duration ? Math.round(Number(w.duration)) : null;
        const calories = w.calories ? Math.round(Number(w.calories)) : null;
        const distance = w.distance ? Math.round(Number(w.distance)) : null;

        const actRes = await pool.query(
          'INSERT INTO activities (user_id, type, started_at, duration_sec, calories_kcal, notes, source, external_id) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
          [
            req.userId,
            mappedType,
            w.start,
            duration,
            calories,
            'Synkroniseret fra Apple Health',
            'healthkit',
            externalId,
          ]
        );

        // Hvis run eller bike, gem distance i detail-tabellen
        if ((mappedType === 'run' || mappedType === 'bike') && distance) {
          const detailTable = mappedType === 'run' ? 'activity_run_details' : 'activity_bike_details';
          try {
            await pool.query(
              'INSERT INTO ' + detailTable + ' (activity_id, distance_m) VALUES ($1, $2)',
              [actRes.rows[0].id, distance]
            );
          } catch (de) {
            console.warn('Could not insert detail for', externalId, de.message);
          }
        }

        inserted++;
      } catch (e) {
        console.error('Sync workout error:', e.message);
        errors++;
      }
    }

    res.json({ inserted, skipped, errors, total: workouts.length });
  } catch (err) {
    console.error('sync-healthkit error:', err);
    res.status(500).json({ error: 'HealthKit sync fejlede' });
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
      '    \'kcal\', mi.kcal, \'protein_g\', mi.protein_g, \'carbs_g\', mi.carbs_g, \'fat_g\', mi.fat_g, \'amount\', mi.amount, \'unit\', mi.unit, ' +
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
        'INSERT INTO meal_items (meal_id, food_id, amount_g, kcal, protein_g, carbs_g, fat_g, amount, unit) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
        [
          meal.id,
          item.food_id || null,
          item.amount_g,
          item.kcal,
          item.protein_g || 0,
          item.carbs_g || 0,
          item.fat_g || 0,
          item.amount || null,
          item.unit || null,
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

// ════════════════════════════════ FAVORITES & HISTORY ════════════════════════════════
async function initFavoritesTable() {
  try {
    // Migration: drop old table if it has wrong food_id type (INTEGER instead of UUID)
    const check = await pool.query(
      "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='user_favorites' AND column_name='food_id'"
    );
    if (check.rows.length > 0 && check.rows[0].data_type !== 'uuid') {
      console.log('Migrating user_favorites: dropping old table with food_id type=' + check.rows[0].data_type);
      await pool.query('DROP TABLE user_favorites');
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_favorites (
        user_id INTEGER NOT NULL,
        food_id UUID NOT NULL,
        last_amount NUMERIC,
        last_unit TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, food_id)
      );
    `);
    console.log('user_favorites table ready');
  } catch (err) {
    console.error('initFavoritesTable error:', err);
  }
}

app.get('/meals/recent', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (mi.food_id)
         f.id, f.source, f.source_id, f.name, f.brand, f.serving_size_g,
         f.kcal_per_100g, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.is_verified,
         mi.amount AS last_amount, mi.unit AS last_unit,
         m.eaten_at AS last_eaten_at
       FROM meal_items mi
       JOIN meals m ON m.id = mi.meal_id
       JOIN foods f ON f.id = mi.food_id
       WHERE m.user_id = $1
       ORDER BY mi.food_id, m.eaten_at DESC
       LIMIT 20`,
      [req.userId]
    );
    // Sort by last_eaten_at DESC after DISTINCT ON
    const sorted = result.rows.sort((a, b) => new Date(b.last_eaten_at) - new Date(a.last_eaten_at));
    res.json(sorted);
  } catch (err) {
    console.error('GET /meals/recent error:', err);
    res.status(500).json({ error: 'Kunne ikke hente seneste maaltider' });
  }
});

// GET /meals/frequent - top 10 hyppigst loggede sidste 30 dage
app.get('/meals/frequent', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id, f.source, f.source_id, f.name, f.brand, f.serving_size_g,
              f.kcal_per_100g, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.is_verified,
              COUNT(*) AS log_count,
              MAX(m.eaten_at) AS last_eaten_at,
              (ARRAY_AGG(mi.amount ORDER BY m.eaten_at DESC))[1] AS last_amount,
              (ARRAY_AGG(mi.unit ORDER BY m.eaten_at DESC))[1] AS last_unit
       FROM meal_items mi
       JOIN meals m ON m.id = mi.meal_id
       JOIN foods f ON f.id = mi.food_id
       WHERE m.user_id = $1
         AND m.eaten_at >= NOW() - INTERVAL '30 days'
       GROUP BY f.id
       ORDER BY log_count DESC, last_eaten_at DESC
       LIMIT 10`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /meals/frequent error:', err);
    res.status(500).json({ error: 'Kunne ikke hente hyppige maaltider' });
  }
});

// GET /favorites - alle brugerens favoritter
app.get('/favorites', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id, f.source, f.source_id, f.name, f.brand, f.serving_size_g,
              f.kcal_per_100g, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.is_verified,
              uf.last_amount, uf.last_unit, uf.created_at AS favorited_at
       FROM user_favorites uf
       JOIN foods f ON f.id = uf.food_id
       WHERE uf.user_id = $1
       ORDER BY uf.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /favorites error:', err);
    res.status(500).json({ error: 'Kunne ikke hente favoritter' });
  }
});

// POST /favorites/:foodId - tilfoej til favoritter
app.post('/favorites/:foodId', authMiddleware, async (req, res) => {
  try {
    const foodId = req.params.foodId;
    if (!foodId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(foodId)) {
      return res.status(400).json({ error: 'Ugyldigt food id' });
    }
    const { last_amount, last_unit } = req.body || {};
    await pool.query(
      `INSERT INTO user_favorites (user_id, food_id, last_amount, last_unit)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, food_id)
       DO UPDATE SET last_amount = EXCLUDED.last_amount, last_unit = EXCLUDED.last_unit`,
      [req.userId, foodId, last_amount || null, last_unit || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /favorites error:', err);
    res.status(500).json({ error: 'Kunne ikke gemme favorit' });
  }
});

app.delete('/favorites/:foodId', authMiddleware, async (req, res) => {
  try {
    const foodId = req.params.foodId;
    if (!foodId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(foodId)) {
      return res.status(400).json({ error: 'Ugyldigt food id' });
    }
    await pool.query(
      'DELETE FROM user_favorites WHERE user_id = $1 AND food_id = $2',
      [req.userId, foodId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /favorites error:', err);
    res.status(500).json({ error: 'Kunne ikke fjerne favorit' });
  }
});

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

    
    // ==== Trin 3: OpenAI fritekst-fallback (kun hvis ingen lokale + ingen OFF-resultater) ====
    if (combined.length === 0 && process.env.OPENAI_API_KEY) {
      try {
        const aiPrompt = `Du er en ekspert i dansk og international fodevarer-naeringsindhold. Estimer naeringsindhold per 100 gram for: "${q}". Returner KUN gyldig JSON i dette format uden markdown-blok:
{"name":"<navn på dansk>","kcal_per_100g":<tal>,"protein_g":<tal>,"carbs_g":<tal>,"fat_g":<tal>,"fiber_g":<tal>,"serving_size_g":<typisk portion i gram>}
Hvis du ikke kan identificere fodevaren, returner: {"error":"unknown"}`;
        const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: aiPrompt }],
            max_tokens: 200,
            temperature: 0.3,
            response_format: { type: 'json_object' },
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const aiText = aiData.choices && aiData.choices[0] && aiData.choices[0].message && aiData.choices[0].message.content;
          if (aiText) {
            const parsed = JSON.parse(aiText);
            if (!parsed.error && parsed.name && typeof parsed.kcal_per_100g === 'number') {
              const aiId = 'ai_' + q.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);
              const cached = await cacheFood(
                'openai',
                aiId,
                parsed.name,
                null,
                parsed.serving_size_g || 100,
                parsed.kcal_per_100g,
                parsed.protein_g || 0,
                parsed.carbs_g || 0,
                parsed.fat_g || 0,
                parsed.fiber_g || 0
              );
              if (cached) combined.push(cached);
            }
          }
        }
      } catch (aiErr) {
        console.error('OpenAI search fallback error:', aiErr.message);
      }
    }

    res.json(combined);
  } catch (err) {
    console.error('Search foods error:', err);
    res.status(500).json({ error: 'Kunne ikke soge i foedevarer' });
  }
});

// GET /foods/barcode/:ean - SlÃ¥ produkt op via stregkode (Open Food Facts)

// GET /admin/health-check - Diagnose database tables (admin only)
app.get('/admin/health-check', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/, '').trim();
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const result = {
      timestamp: new Date().toISOString(),
      tables: {},
      counts: {},
      errors: []
    };

    const expectedTables = ['users', 'foods', 'meals', 'user_favorites', 'activities', 'runs'];
    for (const tbl of expectedTables) {
      try {
        const r = await pool.query(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS exists",
          [tbl]
        );
        result.tables[tbl] = r.rows[0].exists;
        if (r.rows[0].exists) {
          try {
            const c = await pool.query('SELECT COUNT(*)::int AS n FROM ' + tbl);
            result.counts[tbl] = c.rows[0].n;
          } catch (e) {
            result.counts[tbl] = 'ERR: ' + e.message;
          }
        }
      } catch (e) {
        result.errors.push(tbl + ': ' + e.message);
      }
    }

    try {
      const cols = await pool.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='user_favorites'"
      );
      result.user_favorites_columns = cols.rows;
    } catch (e) {
      result.user_favorites_columns = 'ERR: ' + e.message;
    }

    try {
      const recent = await pool.query(
        "SELECT user_id, food_id, last_amount, last_unit, created_at FROM user_favorites ORDER BY created_at DESC LIMIT 10"
      );
      result.recent_favorites = recent.rows;
      const perUser = await pool.query(
        "SELECT user_id, COUNT(*)::int AS n FROM user_favorites GROUP BY user_id ORDER BY n DESC"
      );
      result.favorites_per_user = perUser.rows;
      const recentUsers = await pool.query(
        "SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT 5"
      );
      result.recent_users = recentUsers.rows;
    } catch (e) {
      result.errors.push('recent_favorites: ' + e.message);
    }

    // Test the actual queries that fail
    try {
      const favQuery = await pool.query(
        `SELECT f.id, f.source, f.source_id, f.name, f.brand, f.serving_size_g,
                f.kcal_per_100g, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.is_verified,
                uf.last_amount, uf.last_unit, uf.created_at AS favorited_at
           FROM user_favorites uf
           JOIN foods f ON f.id = uf.food_id
          WHERE uf.user_id = $1
          ORDER BY uf.created_at DESC`,
        [1]
      );
      result.test_favorites_query = { ok: true, rows: favQuery.rows.length };
    } catch (e) {
      result.test_favorites_query = { ok: false, error: e.message, code: e.code, detail: e.detail };
    }

    try {
      const foodCols = await pool.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='foods' ORDER BY column_name"
      );
      result.foods_columns = foodCols.rows.map(r => r.column_name);
    } catch (e) {
      result.foods_columns = 'ERR: ' + e.message;
    }

    try {
      const end = new Date().toISOString().slice(0,10);
      const start = new Date(Date.now() - 6*24*60*60*1000).toISOString().slice(0,10);
      const mealQuery = await pool.query(
        `SELECT DATE(eaten_at) AS day, SUM(kcal)::int AS kcal
           FROM meals
          WHERE user_id = $1 AND eaten_at >= $2 AND eaten_at < ($3::date + INTERVAL '1 day')
          GROUP BY day ORDER BY day`,
        [1, start, end]
      );
      result.test_summary_meals = { ok: true, rows: mealQuery.rows };
    } catch (e) {
      result.test_summary_meals = { ok: false, error: e.message, code: e.code, detail: e.detail };
    }

    try {
      const mealCols = await pool.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='meals' ORDER BY column_name"
      );
      result.meals_columns = mealCols.rows.map(r => r.column_name);
    } catch (e) {
      result.meals_columns = 'ERR: ' + e.message;
    }

    res.json(result);
  } catch (err) {
    console.error('health-check error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/seed-basics - Seed Danish basic foods (Frida-based) - admin only
app.post('/admin/seed-basics', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/, '').trim();
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }

  const FRIDA_BASICS = [
    ["Kyllingebryst (rå)",110,23.1,0,1.5,0,150],
    ["Kyllingelår (rå)",165,18.5,0,9.8,0,130],
    ["Kylling stegt med skind",215,25,0,12,0,130],
    ["Hakket oksekød 8-12%",175,20,0,10,0,125],
    ["Hakket oksekød 4-7%",135,21,0,5,0,125],
    ["Oksefilet (rå)",130,22,0,4,0,150],
    ["Hakket svinekød 8-12%",195,19,0,13,0,125],
    ["Hakket kalkun",130,22,0,4,0,125],
    ["Svinekam uden fedt",130,22,0,4.5,0,150],
    ["Bacon stegt",540,37,1.4,42,0,30],
    ["Hamburgerryg",110,21,0.5,2.5,0,50],
    ["Skinke, kogt",110,20,0.5,3,0,30],
    ["Spegepølse",380,22,1,32,0,25],
    ["Leverpostej",280,11,4,24,0,20],
    ["Frikadelle (stegt)",220,16,8,14,1,80],
    ["Medisterpølse stegt",270,13,6,22,0.5,100],
    ["Laks (rå)",200,20,0,13,0,150],
    ["Laks (røget)",165,23,0,8,0,50],
    ["Torsk (rå)",76,17.5,0,0.5,0,150],
    ["Sild (marineret)",200,14,6,13,0,50],
    ["Makrel i tomat",195,13,4,14,0.5,75],
    ["Tun i vand (dåse)",110,25,0,1,0,60],
    ["Tun i olie (dåse)",195,24,0,11,0,60],
    ["Rejer (kogte)",100,22,0.5,1.2,0,50],
    ["Fiskefrikadelle",195,14,12,10,1,75],
    ["Æg (helt)",145,12.5,0.7,10,0,60],
    ["Æggehvide",50,11,0.7,0.2,0,35],
    ["Æggeblomme",320,16,3.6,27,0,18],
    ["Sødmælk 3.5%",64,3.4,4.7,3.5,0,200],
    ["Letmælk 1.5%",47,3.4,4.8,1.5,0,200],
    ["Minimælk 0.4%",36,3.4,4.9,0.4,0,200],
    ["Skummetmælk 0.1%",33,3.5,5,0.1,0,200],
    ["Kaerneamælk",38,3.4,4,0.5,0,200],
    ["A38 letmælk",56,4,5.5,1.5,0,150],
    ["Yoghurt naturel 1.5%",60,5,5.5,1.5,0,150],
    ["Skyr naturel",65,11,4,0.2,0,150],
    ["Skyr vanilje",75,10,8,0.2,0,150],
    ["Cottage cheese",100,13,3,4,0,100],
    ["Hytteost 1.5%",80,13,3,1.5,0,100],
    ["Kvark naturel 0.2%",60,12,4,0.2,0,150],
    ["Cremefraiche 18%",195,2.5,4,18,0,30],
    ["Cremefraiche 9%",115,3,4.5,9,0,30],
    ["Cremefraiche 38%",360,2.2,3,38,0,20],
    ["Piskefløde 38%",360,2,3,38,0,100],
    ["Madlavningsfløde 18%",195,2.5,4,18,0,100],
    ["Smør",745,0.6,0.7,82,0,10],
    ["Margarine 80%",720,0.2,0.5,80,0,10],
    ["Minarine 40%",360,0.3,0.6,40,0,10],
    ["Cheddar ost",405,25,1,33,0,25],
    ["Danbo 30+ ost",285,26,0,20,0,25],
    ["Danbo 45+ ost",360,24,0,29,0,25],
    ["Mozzarella",250,18,2,19,0,30],
    ["Feta",265,14,1,23,0,30],
    ["Parmesan",410,36,4,28,0,10],
    ["Flødeost (Philadelphia)",250,6,4,23,0,20],
    ["Brieost",335,21,0.5,28,0,30],
    ["Rugbrød",235,8,40,2.5,7,30],
    ["Franskbrød",270,9,50,3,3,30],
    ["Bagerbrød (groft)",245,10,42,4,6,40],
    ["Knækbrød (rug)",320,11,65,1.5,14,10],
    ["Knækbrød (havre)",380,12,60,10,7,10],
    ["Toastbrød",280,9,50,4,3,30],
    ["Pita brød",275,9,55,1,2,60],
    ["Tortilla wrap",305,9,50,7,2,50],
    ["Boller (hvede)",290,10,52,5,3,60],
    ["Croissant",410,8,45,22,2,50],
    ["Havregryn (tørre)",370,13,60,7,10,40],
    ["Havregrød (med vand)",60,2.5,10,1,1.6,250],
    ["Müsli (med tørret frugt)",360,9,65,7,7,50],
    ["Cornflakes",380,7,84,1,3,30],
    ["Cheerios",380,9,76,5,7,30],
    ["Risflakes",380,6,85,1,1,30],
    ["Ris (kogte)",130,2.6,28,0.3,0.4,200],
    ["Basmati ris (kogte)",135,3,29,0.4,0.4,200],
    ["Brune ris (kogte)",125,2.6,26,1,1.8,200],
    ["Pasta (kogt)",130,5,25,1,1.5,200],
    ["Fuldkornspasta (kogt)",125,5.3,23,1.4,4,200],
    ["Kartoffel (kogt)",75,2,17,0.1,1.5,200],
    ["Kartoffel (bagt)",95,2.5,21,0.1,2.2,200],
    ["Pommes frites",270,4,35,13,3,150],
    ["Søde kartofler",90,2,20,0.1,3,200],
    ["Bulgur (kogt)",85,3,19,0.3,4.5,150],
    ["Quinoa (kogt)",120,4.4,21,1.9,2.8,150],
    ["Couscous (kogt)",115,3.8,23,0.2,1.4,150],
    ["Bønner (hvide, kogte)",130,9,20,0.5,7,100],
    ["Kidneybønner (kogte)",130,8.7,22,0.5,6.4,100],
    ["Kikærter (kogte)",165,9,27,2.6,7.6,100],
    ["Linser (kogte)",115,9,20,0.4,8,100],
    ["Æble",50,0.3,11,0.2,2.5,150],
    ["Banan",90,1.1,20,0.3,2.6,120],
    ["Appelsin",45,0.9,9,0.1,2.4,150],
    ["Pære",55,0.4,13,0.1,3.1,150],
    ["Vindrue",70,0.7,17,0.2,0.9,100],
    ["Jordbær",32,0.7,6,0.3,2,100],
    ["Blåbær",57,0.7,12,0.3,2.4,100],
    ["Hindbær",53,1.2,9,0.7,6.5,100],
    ["Brombær",43,1.4,5,0.5,5.3,100],
    ["Kirsebær",63,1.1,14,0.2,2.1,100],
    ["Blomme",46,0.7,10,0.3,1.4,60],
    ["Fersken",39,0.9,8,0.3,1.5,150],
    ["Nektarin",44,1.1,9,0.3,1.7,150],
    ["Abrikos",48,1.4,9,0.4,2,50],
    ["Ananas",50,0.5,11,0.1,1.4,150],
    ["Melon (cantaloupe)",34,0.8,8,0.2,0.9,150],
    ["Vandmelon",30,0.6,7.5,0.2,0.4,200],
    ["Kiwi",61,1.1,12,0.5,3,70],
    ["Mango",60,0.8,13,0.4,1.6,150],
    ["Avocado",160,2,9,15,7,80],
    ["Citron",29,1.1,6,0.3,2.8,50],
    ["Lime",30,0.7,7.7,0.2,2.8,50],
    ["Grapefrugt",42,0.8,8.4,0.1,1.6,150],
    ["Rosiner",300,3,70,0.5,4,25],
    ["Dadler",280,2.5,70,0.4,7,25],
    ["Tørrede abrikoser",240,3.4,55,0.5,7.3,25],
    ["Tomat",18,0.9,3.5,0.2,1.2,100],
    ["Cherrytomat",19,1,3.6,0.2,1.2,100],
    ["Agurk",16,0.7,3.6,0.1,0.5,100],
    ["Salat (iceberg)",14,0.9,2.9,0.1,1.2,50],
    ["Spinat",23,2.9,3.6,0.4,2.2,80],
    ["Grønkål",50,3.3,9,0.7,4,80],
    ["Bønnespirer",30,3,6,0.2,1.8,50],
    ["Broccoli",34,2.8,7,0.4,2.6,100],
    ["Blomkål",25,2,5,0.3,2,100],
    ["Gulerod",41,0.9,10,0.2,2.8,80],
    ["Rødløg",42,1.1,10,0.1,1.7,50],
    ["Løg",40,1.1,9,0.1,1.7,50],
    ["Hvidløg",149,6.4,33,0.5,2.1,5],
    ["Porre",31,1.5,7,0.3,1.8,100],
    ["Selleri",16,0.7,3,0.2,1.6,50],
    ["Champignon",22,3.1,3.3,0.3,1,100],
    ["Peberfrugt (rød)",31,1,6,0.3,2.1,100],
    ["Peberfrugt (grøn)",20,0.9,4.6,0.2,1.7,100],
    ["Squash (zucchini)",17,1.2,3.1,0.3,1,150],
    ["Aubergine",25,1,6,0.2,3,150],
    ["Majs (dåse)",85,3,18,1,2.4,100],
    ["Ærter (frosne)",80,5.5,14,0.4,5.7,80],
    ["Asparges",20,2.2,3.9,0.1,2.1,100],
    ["Rødkål",31,1.4,7.4,0.2,2.1,80],
    ["Hvidkål",25,1.3,5.8,0.1,2.5,80],
    ["Rødbede",43,1.6,10,0.2,2.8,100],
    ["Pastinak",75,1.2,18,0.3,5,100],
    ["Persille",36,3,6,0.8,3.3,5],
    ["Bønner (grønne)",31,1.8,7,0.2,2.7,100],
    ["Mandel",580,21,22,50,12,25],
    ["Valnød",655,15,14,65,6.7,25],
    ["Hasselnød",630,15,17,61,9.7,25],
    ["Cashewnød",555,18,30,44,3.3,25],
    ["Peanut (jordnød)",570,26,16,49,8.5,25],
    ["Peanutbutter",590,25,20,50,6,20],
    ["Pistacie",560,20,28,45,10,25],
    ["Solsikkekerner",580,21,20,51,8.6,20],
    ["Græskarkerner",560,30,11,49,6,20],
    ["Chiafrø",490,17,42,31,34,15],
    ["Hørfrø",535,18,29,42,27,15],
    ["Sesamfrø",575,18,23,50,12,10],
    ["Olivenolie",880,0,0,100,0,10],
    ["Rapsolie",880,0,0,100,0,10],
    ["Solsikkeolie",880,0,0,100,0,10],
    ["Kokosolie",890,0,0,100,0,10],
    ["Mayonnaise",680,1,1.5,75,0,15],
    ["Light mayonnaise",250,1,6,25,0,15],
    ["Ketchup",100,1.2,23,0.2,0.4,15],
    ["Sennep",70,4,6,4,3,5],
    ["Soya sauce",60,8,6,0,0.8,10],
    ["Eddikedressing",80,0.4,8,5,0,10],
    ["Vand",0,0,0,0,0,250],
    ["Kaffe (sort, uden mælk)",2,0.3,0,0,0,200],
    ["Te (uden mælk)",1,0.1,0,0,0,200],
    ["Appelsinjuice",45,0.7,10,0.2,0.2,200],
    ["Æblejuice",46,0.1,11,0.1,0.2,200],
    ["Cola",42,0,11,0,0,330],
    ["Cola Zero",0.5,0,0.1,0,0,330],
    ["Faxe Kondi",41,0,10,0,0,330],
    ["Sodavand (klassisk)",42,0,11,0,0,330],
    ["Pilsner øl 4.6%",43,0.4,3.5,0,0,330],
    ["Rødvin",85,0.1,2.6,0,0,150],
    ["Hvidvin",82,0.1,2.6,0,0,150],
    ["Vodka",235,0,0,0,0,40],
    ["Mørk chokolade 70%",580,8,30,42,11,20],
    ["Mælkechokolade",535,7.5,58,30,3,20],
    ["Honning",305,0.3,80,0,0.2,15],
    ["Sukker",405,0,100,0,0,5],
    ["Brun farin",380,0.1,98,0,0,5],
    ["Marmelade",250,0.3,60,0.1,1,15],
    ["Nutella",540,6,57,31,4,15],
    ["Lakrids",360,1.5,87,0.5,0,20],
    ["Vingummi",350,6,80,0,0,20],
    ["Chips (saltede)",540,6,53,33,4.4,30],
    ["Popcorn (luftpoppet)",380,12,78,4.5,14,20],
    ["Is (vanilje)",200,3.5,24,10,0.5,80],
    ["Småkager",470,6,65,21,2,20],
    ["Hummus",165,8,14,9,6,30],
    ["Tofu",78,8,1.9,4.8,0.3,100],
    ["Sojamælk",33,3.3,0.6,1.8,0.6,200],
    ["Havremælk",47,1,7.5,1.5,1.4,200],
    ["Mandelmælk",14,0.5,0.3,1.1,0.2,200]
  ];

    let inserted = 0;
    let skipped = 0;
    for (const row of FRIDA_BASICS) {
      const [name, kcal, protein, carbs, fat, fiber, serving] = row;
      try {
        const existing = await pool.query(
          "SELECT id FROM foods WHERE source = 'frida' AND name = $1 LIMIT 1",
          [name]
        );
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }
        const sourceId = 'frida_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 80);
        await pool.query(
          'INSERT INTO foods (source, source_id, name, brand, serving_size_g, kcal_per_100g, protein_g, carbs_g, fat_g, fiber_g, is_verified) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
          ['frida', sourceId, name, null, serving, kcal, protein, carbs, fat, fiber, true]
        );
        inserted++;
      } catch (rowErr) {
        console.error('Seed row error for', name, ':', rowErr.message);
      }
    }
    res.json({ ok: true, total: FRIDA_BASICS.length, inserted, skipped });
  } catch (err) {
    console.error('Seed basics error:', err);
    res.status(500).json({ error: 'seed failed' });
  }
});

app.get('/foods/barcode/:ean', authMiddleware, async (req, res) => {
  try {
    const ean = req.params.ean.replace(/[^0-9]/g, '');
    if (ean.length < 8) {
      return res.status(400).json({ error: 'Ugyldig stregkode' });
    }

    // Tjek først lokal cache
    const cached = await pool.query(
      "SELECT * FROM foods WHERE (source = 'openfoodfacts' OR source = 'usda') AND source_id = $1 LIMIT 1",
      [ean]
    );
    if (cached.rows.length > 0) {
      return res.json(cached.rows[0]);
    }

    // Helper: cache et opslag i foods tabel
    async function cacheFood(sourceName, code, name, brand, servingG, kcal, protein, carbs, fat, fiber) {
      try {
        const ins = await pool.query(
          'INSERT INTO foods (source, source_id, name, brand, serving_size_g, kcal_per_100g, protein_g, carbs_g, fat_g, fiber_g, is_verified) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ' +
          'ON CONFLICT (source, source_id) DO UPDATE SET ' +
          '  name = EXCLUDED.name, brand = EXCLUDED.brand, kcal_per_100g = EXCLUDED.kcal_per_100g ' +
          'RETURNING *',
          [sourceName, code, name, brand, servingG, kcal, protein, carbs, fat, fiber, false]
        );
        return ins.rows[0];
      } catch (e) {
        console.error('cacheFood error:', e.message);
        return null;
      }
    }

    // Trin 1: Open Food Facts
    try {
      const offRes = await fetch('https://world.openfoodfacts.org/api/v2/product/' + ean + '.json');
      if (offRes.ok) {
        const offData = await offRes.json();
        if (offData && offData.product) {
          const p = offData.product;
          const n = p.nutriments || {};
          if (n['energy-kcal_100g'] !== undefined) {
            const cached2 = await cacheFood(
              'openfoodfacts',
              ean,
              p.product_name || p.generic_name || 'Ukendt produkt',
              p.brands || null,
              p.serving_quantity ? parseFloat(p.serving_quantity) : null,
              n['energy-kcal_100g'] || 0,
              n.proteins_100g || 0,
              n.carbohydrates_100g || 0,
              n.fat_100g || 0,
              n.fiber_100g || null
            );
            if (cached2) return res.json(cached2);
          }
        }
      }
    } catch (offErr) {
      console.error('OFF lookup error:', offErr.message);
    }

    // Trin 2: USDA FoodData Central (fallback)
    const usdaKey = process.env.USDA_API_KEY;
    if (usdaKey) {
      try {
        const usdaUrl = 'https://api.nal.usda.gov/fdc/v1/foods/search?query=' + encodeURIComponent(ean) +
          '&dataType=Branded&pageSize=5&api_key=' + usdaKey;
        const usdaRes = await fetch(usdaUrl);
        if (usdaRes.ok) {
          const usdaData = await usdaRes.json();
          const foods = (usdaData && usdaData.foods) || [];
          const match = foods.find(function (f) {
            const g = (f.gtinUpc || '').replace(/[^0-9]/g, '');
            return g === ean || g === ('0' + ean) || ean === ('0' + g);
          }) || (foods.length > 0 ? foods[0] : null);
          if (match) {
            const nutrMap = {};
            (match.foodNutrients || []).forEach(function (fn) {
              const id = fn.nutrientId || (fn.nutrient && fn.nutrient.id);
              if (id) nutrMap[id] = fn.value || (fn.amount || 0);
            });
            const kcal = nutrMap[1008] || 0;
            if (kcal > 0) {
              const cached3 = await cacheFood(
                'usda',
                ean,
                match.description || 'Ukendt produkt',
                match.brandOwner || match.brandName || null,
                match.servingSize || null,
                kcal,
                nutrMap[1003] || 0,
                nutrMap[1005] || 0,
                nutrMap[1004] || 0,
                nutrMap[1079] || null
              );
              if (cached3) return res.json(cached3);
            }
          }
        }
      } catch (usdaErr) {
        console.error('USDA lookup error:', usdaErr.message);
      }
    }

    return res.status(404).json({ error: 'Produkt ikke fundet' });
  } catch (err) {
    console.error('Barcode lookup error:', err);
    res.status(500).json({ error: 'Kunne ikke slå stregkode op' });
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
// POST /foods/parse-text - AI tolkning af fri tekst til madvarer
app.post('/foods/parse-text', authMiddleware, async (req, res) => {
  try {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI ikke konfigureret' });

    const { text } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length < 2) {
      return res.status(400).json({ error: 'text er paakraevet' });
    }

    const systemPrompt = 'Du er en dansk ernaeringsekspert. Brugeren skriver hvad de har spist i fri tekst paa dansk. Bryd det op i individuelle madvarer med estimerede maengder i gram. Returner ALTID kun gyldig JSON uden markdown. Format: {"items": [{"name": "dansk navn", "estimated_grams": tal, "kcal_per_100g": tal, "protein_g": tal, "carbs_g": tal, "fat_g": tal, "confidence": 0-1}]}. Standard portioner: krydderbolle=60g, skive broed=30g, skive paalaeg=15g, spsk smoer=15g, aeble=180g, banan=120g, glas maelk=200g.';
    const userPrompt = 'Tolk og returner JSON: ' + text.trim();

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
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      console.error('Anthropic parse-text error:', data);
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

    const items = parsed.items || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        const dbResult = await pool.query(
          'SELECT id, name, brand, kcal_per_100g, protein_g, carbs_g, fat_g FROM foods WHERE LOWER(name) LIKE $1 ORDER BY is_verified DESC LIMIT 1',
          ['%' + (it.name || '').toLowerCase() + '%']
        );
        if (dbResult.rows.length > 0) {
          const dbFood = dbResult.rows[0];
          it.food_id = dbFood.id;
          it.name = dbFood.name;
          it.brand = dbFood.brand;
          it.kcal_per_100g = Number(dbFood.kcal_per_100g);
          it.protein_g = Number(dbFood.protein_g);
          it.carbs_g = Number(dbFood.carbs_g);
          it.fat_g = Number(dbFood.fat_g);
          it.from_db = true;
        } else {
          it.from_db = false;
        }
      } catch (e) {
        console.warn('DB lookup failed for', it.name, e.message);
        it.from_db = false;
      }
    }

    res.json({ items: items, raw: rawText });
  } catch (err) {
    console.error('parse-text error:', err);
    res.status(500).json({ error: 'Tekst-tolkning fejlede' });
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


// GET /meals/summary-range?days=7
// Returns array of last N days: [{date, kcal_in, kcal_out_activity, protein_g, carbs_g, fat_g}, ...]
// Ordered oldest -> newest
// GET /meals/summary-range?start=YYYY-MM-DD&end=YYYY-MM-DD - Daglig oversigt for periode
app.get('/meals/summary-range', authMiddleware, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: 'start og end skal vaere YYYY-MM-DD' });
    }

    // Meals: sum kcal/protein/carbs/fat per day from meal_items joined with meals
    const mealsResult = await pool.query(
      `SELECT TO_CHAR(DATE(m.eaten_at), 'YYYY-MM-DD') AS day,
              COALESCE(SUM(mi.kcal), 0)::int AS kcal,
              COALESCE(SUM(mi.protein_g), 0)::numeric AS protein_g,
              COALESCE(SUM(mi.carbs_g), 0)::numeric AS carbs_g,
              COALESCE(SUM(mi.fat_g), 0)::numeric AS fat_g
         FROM meal_items mi
         JOIN meals m ON m.id = mi.meal_id
        WHERE m.user_id = $1
          AND m.eaten_at >= $2::date
          AND m.eaten_at < ($3::date + INTERVAL '1 day')
        GROUP BY DATE(m.eaten_at)
        ORDER BY DATE(m.eaten_at)`,
      [req.userId, start, end]
    );

    // Activities: sum kcal_burned per day
    let activitiesResult = { rows: [] };
    try {
      activitiesResult = await pool.query(
        `SELECT TO_CHAR(DATE(started_at), 'YYYY-MM-DD') AS day,
                COALESCE(SUM(kcal_burned), 0)::int AS kcal_burned
           FROM activities
          WHERE user_id = $1
            AND started_at >= $2::date
            AND started_at < ($3::date + INTERVAL '1 day')
          GROUP BY DATE(started_at)
          ORDER BY DATE(started_at)`,
        [req.userId, start, end]
      );
    } catch (e) { /* activities table may have different schema */ }

    // Runs: sum kcal per day
    let runsResult = { rows: [] };
    try {
      runsResult = await pool.query(
        `SELECT TO_CHAR(DATE(started_at), 'YYYY-MM-DD') AS day,
                COALESCE(SUM(calories), 0)::int AS run_kcal
           FROM runs
          WHERE user_id = $1
            AND started_at >= $2::date
            AND started_at < ($3::date + INTERVAL '1 day')
          GROUP BY DATE(started_at)
          ORDER BY DATE(started_at)`,
        [req.userId, start, end]
      );
    } catch (e) { /* runs table may have different schema */ }

    // Build day list from start to end
    const startDate = new Date(start + 'T00:00:00Z');
    const endDate = new Date(end + 'T00:00:00Z');
    const days = [];
    for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }

    const mealsByDay = {};
    mealsResult.rows.forEach(r => { mealsByDay[r.day] = r; });
    const actByDay = {};
    activitiesResult.rows.forEach(r => { actByDay[r.day] = r; });
    const runsByDay = {};
    runsResult.rows.forEach(r => { runsByDay[r.day] = r; });

    const summary = days.map(day => ({
      day,
      kcal_in: mealsByDay[day] ? Number(mealsByDay[day].kcal) : 0,
      protein_g: mealsByDay[day] ? Number(mealsByDay[day].protein_g) : 0,
      carbs_g: mealsByDay[day] ? Number(mealsByDay[day].carbs_g) : 0,
      fat_g: mealsByDay[day] ? Number(mealsByDay[day].fat_g) : 0,
      kcal_out: (actByDay[day] ? Number(actByDay[day].kcal_burned) : 0) + (runsByDay[day] ? Number(runsByDay[day].run_kcal) : 0)
    }));

    res.json(summary);
  } catch (err) {
    console.error('GET /meals/summary-range error:', err);
    res.status(500).json({ error: 'Kunne ikke hente periode-oversigt' });
  }
});


registerStrengthEndpoints(app, pool, authMiddleware);
registerMealPlanEndpoints(app, pool, authMiddleware);
initFavoritesTable();
app.listen(PORT, () => {
  console.log(`ðŸƒ RunWithAI server kÃ¸rer pÃ¥ port ${PORT}`);
  console.log(`ðŸ“¦ Version: 3.0.1-revenuecat`);
});
