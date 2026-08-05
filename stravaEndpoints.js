const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const PROVIDER = 'strava';
const STRAVA_OAUTH_BASE = 'https://www.strava.com/oauth';
const STRAVA_API_BASE = process.env.STRAVA_API_BASE || 'https://www.strava.com/api/v3';
const DEFAULT_APP_REDIRECT = 'app.runwithai://strava-callback';

function getConfig() {
  return {
    clientId: process.env.STRAVA_CLIENT_ID || '',
    clientSecret: process.env.STRAVA_CLIENT_SECRET || '',
    callbackUrl: process.env.STRAVA_CALLBACK_URL || 'https://runwithai-server-production.up.railway.app/integrations/strava/callback',
    appRedirectUrl: process.env.STRAVA_APP_REDIRECT_URI || DEFAULT_APP_REDIRECT,
    encryptionKey: process.env.STRAVA_TOKEN_ENCRYPTION_KEY || '',
  };
}

function isConfigured(config = getConfig()) {
  return Boolean(config.clientId && config.clientSecret && config.callbackUrl && config.encryptionKey);
}

function encryptionKey(config = getConfig()) {
  if (!config.encryptionKey) throw new Error('STRAVA_TOKEN_ENCRYPTION_KEY is missing');
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

function encrypt(value, config = getConfig()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(config), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(part => part.toString('base64url')).join('.');
}

function decrypt(value, config = getConfig()) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted token');
  const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(config), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { message: text }; }
  if (!response.ok) {
    const message = data.message || data.error || `${label} failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

function normalizeRoute(rawRoute) {
  let route = rawRoute;
  if (typeof route === 'string') {
    try { route = JSON.parse(route); } catch (_) { return []; }
  }
  if (!Array.isArray(route)) return [];
  return route.map(point => ({
    lat: Number(point.lat != null ? point.lat : point.latitude),
    lng: Number(point.lng != null ? point.lng : point.longitude),
    altitude: point.altitude == null ? null : Number(point.altitude),
  })).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildGpx(run) {
  const route = normalizeRoute(run.route);
  if (route.length < 2) return null;
  const durationMs = Math.max(1000, Number(run.duration || 0) * 1000);
  const startMs = new Date(run.date || run.created_at || Date.now()).getTime();
  const safeStart = Number.isFinite(startMs) ? startMs : Date.now() - durationMs;
  const activityStart = safeStart - durationMs;
  const denominator = Math.max(1, route.length - 1);
  const points = route.map((point, index) => {
    const time = new Date(activityStart + Math.round((durationMs * index) / denominator)).toISOString();
    const elevation = Number.isFinite(point.altitude) ? `<ele>${point.altitude.toFixed(1)}</ele>` : '';
    return `<trkpt lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(7)}">${elevation}<time>${time}</time></trkpt>`;
  }).join('');
  const name = run.type === 'walk' ? 'RunWithAI Walk' : 'RunWithAI Run';
  return `<?xml version="1.0" encoding="UTF-8"?><gpx creator="RunWithAI" version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><metadata><time>${new Date(activityStart).toISOString()}</time></metadata><trk><name>${xmlEscape(name)}</name><type>${run.type === 'walk' ? 'walking' : 'running'}</type><trkseg>${points}</trkseg></trk></gpx>`;
}

function startDateForRun(run) {
  const endMs = new Date(run.date || run.created_at || Date.now()).getTime();
  const durationMs = Math.max(0, Number(run.duration || 0) * 1000);
  return new Date((Number.isFinite(endMs) ? endMs : Date.now()) - durationMs);
}

async function exchangeAuthorizationCode(code, config) {
  const response = await fetch(`${STRAVA_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
    }).toString(),
  });
  return readJsonResponse(response, 'Strava authorization');
}

async function refreshAccessToken(refreshToken, config) {
  const response = await fetch(`${STRAVA_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  return readJsonResponse(response, 'Strava token refresh');
}

async function storeTokens(pool, userId, tokenData, config) {
  const athlete = tokenData.athlete || {};
  const athleteName = [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') || athlete.username || null;
  const expiresAt = new Date(Number(tokenData.expires_at || 0) * 1000);
  await pool.query(`
    INSERT INTO oauth_integrations
      (user_id, provider, access_token_encrypted, refresh_token_encrypted, token_expires_at,
       provider_user_id, provider_username, scopes, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (user_id, provider) DO UPDATE SET
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      token_expires_at = EXCLUDED.token_expires_at,
      provider_user_id = COALESCE(EXCLUDED.provider_user_id, oauth_integrations.provider_user_id),
      provider_username = COALESCE(EXCLUDED.provider_username, oauth_integrations.provider_username),
      scopes = EXCLUDED.scopes,
      updated_at = NOW()
  `, [
    userId,
    PROVIDER,
    encrypt(tokenData.access_token, config),
    encrypt(tokenData.refresh_token, config),
    expiresAt,
    athlete.id ? String(athlete.id) : null,
    athleteName,
    'activity:write',
  ]);
}

async function getAccessToken(pool, userId, config) {
  const result = await pool.query(
    'SELECT * FROM oauth_integrations WHERE user_id = $1 AND provider = $2',
    [userId, PROVIDER]
  );
  if (result.rows.length === 0) return null;
  const integration = result.rows[0];
  const expiresAt = new Date(integration.token_expires_at).getTime();
  if (expiresAt > Date.now() + 60 * 1000) {
    return decrypt(integration.access_token_encrypted, config);
  }
  const refreshed = await refreshAccessToken(decrypt(integration.refresh_token_encrypted, config), config);
  await storeTokens(pool, userId, refreshed, config);
  return refreshed.access_token;
}

async function createManualActivity(accessToken, run) {
  const body = new URLSearchParams({
    name: run.type === 'walk' ? 'RunWithAI Walk' : 'RunWithAI Run',
    sport_type: run.type === 'walk' ? 'Walk' : 'Run',
    start_date_local: startDateForRun(run).toISOString(),
    elapsed_time: String(Math.max(1, Math.round(Number(run.duration || 0)))),
    distance: String(Math.max(0, Number(run.km || 0) * 1000)),
    description: 'Synced from RunWithAI',
  });
  const response = await fetch(`${STRAVA_API_BASE}/activities`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return readJsonResponse(response, 'Strava activity creation');
}

async function uploadGpx(accessToken, run, gpx) {
  const form = new FormData();
  form.append('data_type', 'gpx');
  form.append('sport_type', run.type === 'walk' ? 'Walk' : 'Run');
  form.append('name', run.type === 'walk' ? 'RunWithAI Walk' : 'RunWithAI Run');
  form.append('description', 'Synced from RunWithAI');
  form.append('external_id', `runwithai-${run.id}`);
  form.append('file', new Blob([gpx], { type: 'application/gpx+xml' }), `runwithai-${run.id}.gpx`);
  const response = await fetch(`${STRAVA_API_BASE}/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  return readJsonResponse(response, 'Strava GPX upload');
}

async function waitForUpload(accessToken, uploadId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const response = await fetch(`${STRAVA_API_BASE}/uploads/${uploadId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const upload = await readJsonResponse(response, 'Strava upload status');
    if (upload.error) throw new Error(upload.error);
    if (upload.activity_id) return upload;
  }
  throw new Error('Strava upload processing timed out');
}

function registerStravaEndpoints(app, pool, authMiddleware, options = {}) {
  const jwtSecret = options.jwtSecret;

  async function syncRunToStrava(userId, run) {
    const config = getConfig();
    if (!isConfigured(config) || !run || !run.id) return { skipped: true, reason: 'not_configured' };

    const connected = await pool.query(
      'SELECT id FROM oauth_integrations WHERE user_id = $1 AND provider = $2',
      [userId, PROVIDER]
    );
    if (connected.rows.length === 0) return { skipped: true, reason: 'not_connected' };

    const existing = await pool.query(
      'SELECT status, external_id FROM integration_exports WHERE provider = $1 AND run_id = $2',
      [PROVIDER, run.id]
    );
    if (existing.rows[0] && existing.rows[0].status === 'completed') {
      return { skipped: true, reason: 'already_exported', externalId: existing.rows[0].external_id };
    }

    await pool.query(`
      INSERT INTO integration_exports (user_id, provider, run_id, status, updated_at)
      VALUES ($1, $2, $3, 'pending', NOW())
      ON CONFLICT (provider, run_id) DO UPDATE SET status = 'pending', error = NULL, updated_at = NOW()
    `, [userId, PROVIDER, run.id]);

    try {
      const accessToken = await getAccessToken(pool, userId, config);
      if (!accessToken) return { skipped: true, reason: 'not_connected' };
      const gpx = buildGpx(run);
      let result;
      if (gpx) {
        const submitted = await uploadGpx(accessToken, run, gpx);
        result = await waitForUpload(accessToken, submitted.id);
      } else {
        result = await createManualActivity(accessToken, run);
      }
      const externalId = result.activity_id || result.id_str || result.id;
      await pool.query(`
        UPDATE integration_exports
        SET status = 'completed', external_id = $1, error = NULL, updated_at = NOW()
        WHERE provider = $2 AND run_id = $3
      `, [externalId ? String(externalId) : null, PROVIDER, run.id]);
      await pool.query(
        'UPDATE oauth_integrations SET last_sync_at = NOW(), updated_at = NOW() WHERE user_id = $1 AND provider = $2',
        [userId, PROVIDER]
      );
      return { success: true, externalId };
    } catch (error) {
      await pool.query(`
        UPDATE integration_exports
        SET status = 'failed', error = $1, updated_at = NOW()
        WHERE provider = $2 AND run_id = $3
      `, [String(error.message || error).slice(0, 1000), PROVIDER, run.id]);
      throw error;
    }
  }

  app.get('/integrations/status', authMiddleware, async (req, res) => {
    try {
      const config = getConfig();
      const result = await pool.query(`
        SELECT provider_username, last_sync_at
        FROM oauth_integrations
        WHERE user_id = $1 AND provider = $2
      `, [req.userId, PROVIDER]);
      const row = result.rows[0];
      res.json({
        strava: {
          connected: Boolean(row),
          configured: isConfigured(config),
          athleteName: row ? row.provider_username : null,
          lastSyncAt: row ? row.last_sync_at : null,
        },
      });
    } catch (error) {
      console.error('Integration status error:', error);
      res.status(500).json({ error: 'Kunne ikke hente integrationsstatus' });
    }
  });

  app.get('/integrations/strava/connect-url', authMiddleware, async (req, res) => {
    const config = getConfig();
    if (!isConfigured(config)) {
      return res.status(503).json({ error: 'strava_not_configured' });
    }
    const state = jwt.sign(
      { userId: req.userId, purpose: 'strava-connect' },
      jwtSecret,
      { expiresIn: '10m' }
    );
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'activity:write',
      state,
    });
    res.json({ url: `${STRAVA_OAUTH_BASE}/authorize?${params.toString()}` });
  });

  app.get('/integrations/strava/callback', async (req, res) => {
    const config = getConfig();
    const redirect = new URL(config.appRedirectUrl || DEFAULT_APP_REDIRECT);
    try {
      if (req.query.error) throw new Error(req.query.error);
      const payload = jwt.verify(String(req.query.state || ''), jwtSecret);
      if (payload.purpose !== 'strava-connect' || !payload.userId) throw new Error('Invalid OAuth state');
      const tokenData = await exchangeAuthorizationCode(String(req.query.code || ''), config);
      await storeTokens(pool, payload.userId, tokenData, config);
      redirect.searchParams.set('status', 'connected');
    } catch (error) {
      console.error('Strava callback error:', error.message);
      redirect.searchParams.set('status', 'error');
      redirect.searchParams.set('message', 'strava_connection_failed');
    }
    res.redirect(redirect.toString());
  });

  app.delete('/integrations/strava', authMiddleware, async (req, res) => {
    try {
      await pool.query('DELETE FROM oauth_integrations WHERE user_id = $1 AND provider = $2', [req.userId, PROVIDER]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Kunne ikke afbryde Strava' });
    }
  });

  app.post('/integrations/strava/sync', authMiddleware, async (req, res) => {
    try {
      const runs = await pool.query(`
        SELECT r.*
        FROM runs r
        LEFT JOIN integration_exports ie ON ie.provider = $2 AND ie.run_id = r.id
        WHERE r.user_id = $1 AND (ie.id IS NULL OR ie.status = 'failed')
        ORDER BY r.date DESC
        LIMIT 20
      `, [req.userId, PROVIDER]);
      const results = [];
      for (const run of runs.rows) {
        try {
          results.push(await syncRunToStrava(req.userId, run));
        } catch (error) {
          results.push({ success: false, runId: run.id, error: error.message });
        }
      }
      res.json({
        success: true,
        synced: results.filter(item => item && item.success).length,
        failed: results.filter(item => item && item.success === false).length,
      });
    } catch (error) {
      console.error('Strava bulk sync error:', error);
      res.status(500).json({ error: 'Kunne ikke synkronisere med Strava' });
    }
  });

  app.post('/integrations/strava/runs/:runId/sync', authMiddleware, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM runs WHERE id = $1 AND user_id = $2', [req.params.runId, req.userId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Løb ikke fundet' });
      res.json(await syncRunToStrava(req.userId, result.rows[0]));
    } catch (error) {
      res.status(502).json({ error: 'Strava-synkronisering fejlede' });
    }
  });

  return { syncRunToStrava };
}

module.exports = {
  registerStravaEndpoints,
  buildGpx,
  normalizeRoute,
  encrypt,
  decrypt,
  isConfigured,
};
