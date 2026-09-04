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
  }),
  Object.freeze({
    version: 2,
    sql: `
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        default_model TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX conversations_owner_status_idx
        ON conversations(owner_user_id, status, updated_at DESC);

      CREATE TABLE gateway_workers (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('starting', 'healthy', 'unhealthy', 'stopping', 'stopped')),
        endpoint TEXT,
        process_id INTEGER,
        version TEXT,
        capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 16),
        last_heartbeat_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX gateway_workers_status_idx ON gateway_workers(status, updated_at);

      CREATE TABLE opencode_sessions (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL UNIQUE
          REFERENCES conversations(id) ON DELETE CASCADE,
        opencode_session_id TEXT NOT NULL UNIQUE,
        worker_id TEXT REFERENCES gateway_workers(id) ON DELETE SET NULL,
        workspace_path TEXT NOT NULL UNIQUE,
        recovery_status TEXT NOT NULL
          CHECK (recovery_status IN ('active', 'recovering', 'interrupted', 'unavailable')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX opencode_sessions_worker_idx ON opencode_sessions(worker_id, recovery_status);

      CREATE TABLE gateway_jobs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        opencode_session_binding_id TEXT REFERENCES opencode_sessions(id) ON DELETE SET NULL,
        worker_id TEXT REFERENCES gateway_workers(id) ON DELETE SET NULL,
        idempotency_key TEXT NOT NULL,
        input_text TEXT NOT NULL CHECK (length(input_text) BETWEEN 1 AND 100000),
        status TEXT NOT NULL CHECK (
          status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'timed_out')
        ),
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        UNIQUE (user_id, idempotency_key)
      ) STRICT;

      CREATE INDEX gateway_jobs_schedule_idx ON gateway_jobs(status, created_at, id);
      CREATE INDEX gateway_jobs_user_status_idx ON gateway_jobs(user_id, status, created_at);
      CREATE INDEX gateway_jobs_conversation_status_idx
        ON gateway_jobs(conversation_id, status, created_at);

      CREATE TABLE gateway_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        job_id TEXT REFERENCES gateway_jobs(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX gateway_events_conversation_sequence_idx
        ON gateway_events(conversation_id, sequence);
      CREATE INDEX gateway_events_job_sequence_idx
        ON gateway_events(job_id, sequence);
    `
  })
]);

module.exports = { MIGRATIONS };
