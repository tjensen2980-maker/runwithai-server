// ═══════════════════════════════════════════════════════════════════════════════
// DELETE ACCOUNT ENDPOINT - Tilføj til din server.js på Railway
// Apple App Store krav: Brugere SKAL kunne slette deres konto
// ═══════════════════════════════════════════════════════════════════════════════
//
// INSTRUKTIONER:
// 1. Åbn din server.js fil på Railway
// 2. Find et godt sted at tilføje denne route (f.eks. efter /profile endpoints)
// 3. Kopier hele kodeblokken herunder ind i filen
// 4. Deploy til Railway
//
// ═══════════════════════════════════════════════════════════════════════════════

// DELETE ACCOUNT - Slet bruger og alle data permanent
app.delete('/delete-account', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  
  console.log(`Delete account request for userId: ${userId}`);
  
  try {
    // Start transaction
    await pool.query('BEGIN');
    
    // 1. Hent brugerinfo til Stripe cleanup
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
    
    // 2. Annuller Stripe subscription hvis den findes
    if (user.stripe_customer_id && stripe) {
      try {
        // Hent aktive subscriptions
        const subscriptions = await stripe.subscriptions.list({
          customer: user.stripe_customer_id,
          status: 'active',
        });
        
        // Annuller hver subscription
        for (const sub of subscriptions.data) {
          await stripe.subscriptions.cancel(sub.id);
          console.log(`Cancelled subscription: ${sub.id}`);
        }
        
        // Slet Stripe customer (valgfrit - kan beholdes for regnskab)
        // await stripe.customers.del(user.stripe_customer_id);
        
      } catch (stripeErr) {
        console.log('Stripe cleanup warning (continuing):', stripeErr.message);
        // Fortsæt selvom Stripe fejler - brugerdata skal stadig slettes
      }
    }
    
    // 3. Slet alle brugerdata fra database
    // Slet i korrekt rækkefølge pga. foreign keys
    
    // Slet løbeture
    try {
      await pool.query('DELETE FROM runs WHERE user_id = $1', [userId]);
    } catch (e) { console.log('No runs table or no runs'); }
    
    // Slet træningsplaner
    try {
      await pool.query('DELETE FROM training_plans WHERE user_id = $1', [userId]);
    } catch (e) { console.log('No training_plans table'); }
    
    // Slet ruter
    try {
      await pool.query('DELETE FROM routes WHERE user_id = $1', [userId]);
    } catch (e) { console.log('No routes table'); }
    
    // Slet sko
    try {
      await pool.query('DELETE FROM shoes WHERE user_id = $1', [userId]);
    } catch (e) { console.log('No shoes table'); }
    
    // Slet subscriptions record
    try {
      await pool.query('DELETE FROM subscriptions WHERE user_id = $1', [userId]);
    } catch (e) { console.log('No subscriptions table'); }
    
    // Slet profil (ofte foreign key til users)
    try {
      await pool.query('DELETE FROM profile WHERE user_id = $1', [userId]);
    } catch (e) { console.log('No profile or already deleted'); }
    
    // 4. Slet selve brugeren
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    
    // Commit transaction
    await pool.query('COMMIT');
    
    console.log(`✅ Account deleted successfully: userId=${userId}, email=${user.email}`);
    
    res.json({ 
      success: true, 
      message: 'Din konto og alle data er blevet slettet permanent.' 
    });
    
  } catch (err) {
    // Rollback ved fejl
    await pool.query('ROLLBACK');
    console.error('❌ Delete account error:', err);
    res.status(500).json({ error: 'Kunne ikke slette konto. Prøv igen senere.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// VIGTIGT: Sørg for at du har disse ting på plads i din server:
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. authenticateToken middleware (du har sikkert allerede denne)
// 2. pool (PostgreSQL connection pool)
// 3. stripe (Stripe SDK instance - hvis du bruger Stripe)
//
// Eksempel på authenticateToken hvis du mangler det:
//
// const authenticateToken = (req, res, next) => {
//   const authHeader = req.headers['authorization'];
//   const token = authHeader && authHeader.split(' ')[1];
//   
//   if (!token) return res.status(401).json({ error: 'Token mangler' });
//   
//   jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
//     if (err) return res.status(403).json({ error: 'Ugyldig token' });
//     req.user = user;
//     next();
//   });
// };
//
// ═══════════════════════════════════════════════════════════════════════════════
