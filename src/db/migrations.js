'use strict';

const MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        session_version INTEGER NOT NULL DEFAULT 0 CHECK (session_version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      ) STRICT;

      CREATE TABLE login_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        csrf_token_hash TEXT NOT NULL,
        session_version INTEGER NOT NULL CHECK (session_version >= 0),
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        source_ip TEXT,
        user_agent TEXT
      ) STRICT;

      CREATE INDEX login_sessions_user_id_idx ON login_sessions(user_id);
      CREATE INDEX login_sessions_expiry_idx ON login_sessions(expires_at);

      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        source_ip TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_user_id, created_at);
      CREATE INDEX audit_logs_action_idx ON audit_logs(action, created_at);
    `
  })
]);

module.exports = { MIGRATIONS };
