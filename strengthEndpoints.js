// ============================================
// STRENGTH ENDPOINTS
// Mounted from Server.js via registerStrengthEndpoints(app, pool, authMiddleware)
// Uses existing set_nr column in strength_sets
// ============================================

function registerStrengthEndpoints(app, pool, authMiddleware) {

  // GET /strength-sessions
  app.get('/strength-sessions', authMiddleware, async function (req, res) {
    try {
      const userId = req.userId;
      const limit = parseInt(req.query.limit, 10) || 50;

      const sessionsResult = await pool.query(
        'SELECT id, user_id, started_at, ended_at, total_volume, total_calories, notes, created_at ' +
        'FROM strength_sessions WHERE user_id = $1 ' +
        'ORDER BY started_at DESC LIMIT $2',
        [userId, limit]
      );

      const sessions = sessionsResult.rows;
      if (sessions.length === 0) return res.json([]);

      const sessionIds = sessions.map(function (s) { return s.id; });

      const setsResult = await pool.query(
        'SELECT s.id, s.session_id, s.exercise_id, s.set_nr AS set_number, s.reps, s.weight_kg, s.rpe, s.created_at, ' +
        'e.name AS exercise_name, e.muscle_groups, e.category ' +
        'FROM strength_sets s ' +
        'LEFT JOIN exercises e ON e.id = s.exercise_id ' +
        'WHERE s.session_id = ANY($1::int[]) ' +
        'ORDER BY s.session_id, s.set_nr',
        [sessionIds]
      );

      const setsBySession = {};
      setsResult.rows.forEach(function (row) {
        if (!setsBySession[row.session_id]) setsBySession[row.session_id] = [];
        setsBySession[row.session_id].push(row);
      });

      const result = sessions.map(function (s) {
        return Object.assign({}, s, { sets: setsBySession[s.id] || [] });
      });

      res.json(result);
    } catch (err) {
      console.error('GET /strength-sessions error:', err);
      res.status(500).json({ error: 'Failed to fetch strength sessions' });
    }
  });

  // POST /strength-sessions
  app.post('/strength-sessions', authMiddleware, async function (req, res) {
    const client = await pool.connect();
    try {
      const userId = req.userId;
      const body = req.body || {};
      const sets = Array.isArray(body.sets) ? body.sets : [];
      const startedAt = body.started_at || new Date().toISOString();
      const endedAt = body.ended_at || new Date().toISOString();
      const notes = body.notes || null;
      const durationMin = parseFloat(body.duration_minutes) || 0;
      const userWeightKg = parseFloat(body.user_weight_kg) || 75;
      const rpe = parseFloat(body.rpe) || 7;

      let totalVolume = 0;
      sets.forEach(function (s) {
        const reps = parseFloat(s.reps) || 0;
        const wt = parseFloat(s.weight_kg) || 0;
        totalVolume += reps * wt;
      });

      const totalSets = sets.length;
      const intensityFactor = 0.7 + (rpe / 14);
      const setBased = Math.round(totalSets * 8 * intensityFactor);
      const met = 5.0 * (0.5 + (rpe / 10));
      const timeBased = Math.round(met * userWeightKg * (durationMin / 60));
      const totalCalories = Math.max(setBased, timeBased);

      await client.query('BEGIN');

      const sessionResult = await client.query(
        'INSERT INTO strength_sessions (user_id, started_at, ended_at, total_volume, total_calories, notes) ' +
        'VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [userId, startedAt, endedAt, totalVolume, totalCalories, notes]
      );
      const session = sessionResult.rows[0];

      for (let i = 0; i < sets.length; i++) {
        const s = sets[i];
        await client.query(
          'INSERT INTO strength_sets (session_id, exercise_id, set_nr, reps, weight_kg, rpe) ' +
          'VALUES ($1, $2, $3, $4, $5, $6)',
          [
            session.id,
            s.exercise_id,
            s.set_number || (i + 1),
            parseInt(s.reps, 10) || 0,
            parseFloat(s.weight_kg) || 0,
            s.rpe ? parseFloat(s.rpe) : null
          ]
        );
      }

      // Mirror to activities table so kcal counts in daily summary
      try {
        await client.query(
          'INSERT INTO activities (user_id, type, started_at, duration_sec, calories_kcal, notes, source) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            userId,
            'strength',
            startedAt,
            Math.round(durationMin * 60),
            totalCalories,
            notes || 'Styrketraening',
            'strength_session'
          ]
        );
      } catch (mirrorErr) {
        console.warn('Could not mirror strength session to activities:', mirrorErr.message);
      }

      await client.query('COMMIT');

      res.json(Object.assign({}, session, {
        sets_count: sets.length,
        total_volume: totalVolume,
        total_calories: totalCalories
      }));
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('POST /strength-sessions error:', err);
      res.status(500).json({ error: 'Failed to create strength session' });
    } finally {
      client.release();
    }
  });

  // GET /exercises/:id/last
  app.get('/exercises/:id/last', authMiddleware, async function (req, res) {
    try {
      const userId = req.userId;
      const exerciseId = req.params.id;

      const result = await pool.query(
        'SELECT s.id, s.session_id, s.set_nr AS set_number, s.reps, s.weight_kg, s.rpe, s.created_at, ' +
        'ses.started_at ' +
        'FROM strength_sets s ' +
        'JOIN strength_sessions ses ON ses.id = s.session_id ' +
        'WHERE ses.user_id = $1 AND s.exercise_id = $2 ' +
        'ORDER BY ses.started_at DESC, s.set_nr ASC ' +
        'LIMIT 20',
        [userId, exerciseId]
      );

      if (result.rows.length === 0) {
        return res.json({ sets: [], last_session_at: null });
      }

      const lastSessionId = result.rows[0].session_id;
      const lastSets = result.rows.filter(function (r) {
        return r.session_id === lastSessionId;
      });

      res.json({
        sets: lastSets,
        last_session_at: result.rows[0].started_at
      });
    } catch (err) {
      console.error('GET /exercises/:id/last error:', err);
      res.status(500).json({ error: 'Failed to fetch last performance' });
    }
  });

}

module.exports = { registerStrengthEndpoints };