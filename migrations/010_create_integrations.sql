CREATE TABLE IF NOT EXISTS oauth_integrations (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  provider_user_id TEXT,
  provider_username TEXT,
  scopes TEXT,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS integration_exports (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, run_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_integrations_user_provider
  ON oauth_integrations(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_integration_exports_user_provider
  ON integration_exports(user_id, provider, status);
