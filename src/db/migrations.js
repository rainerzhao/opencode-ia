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
  }),
  Object.freeze({
    version: 3,
    sql: `
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        slug TEXT NOT NULL COLLATE NOCASE UNIQUE
          CHECK (length(slug) BETWEEN 2 AND 64),
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'published', 'disabled', 'archived')),
        visibility TEXT NOT NULL DEFAULT 'private'
          CHECK (visibility IN ('private', 'team')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX skills_owner_status_idx
        ON skills(owner_user_id, status, updated_at DESC);
      CREATE INDEX skills_visibility_status_idx
        ON skills(visibility, status, updated_at DESC);

      CREATE TABLE skill_versions (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        version TEXT NOT NULL CHECK (length(version) BETWEEN 5 AND 32),
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'validated', 'published', 'retired')),
        skill_md TEXT NOT NULL CHECK (length(skill_md) BETWEEN 1 AND 262144),
        validation_report_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(validation_report_json)),
        content_sha256 TEXT CHECK (content_sha256 IS NULL OR length(content_sha256) = 64),
        created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT,
        UNIQUE (skill_id, version),
        UNIQUE (skill_id, id)
      ) STRICT;

      CREATE INDEX skill_versions_skill_status_idx
        ON skill_versions(skill_id, status, created_at DESC);

      CREATE TABLE skill_installations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        version_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'installed'
          CHECK (status IN ('installed', 'enabled', 'disabled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, skill_id),
        FOREIGN KEY (skill_id, version_id)
          REFERENCES skill_versions(skill_id, id) ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX skill_installations_user_status_idx
        ON skill_installations(user_id, status, updated_at DESC);
    `
  }),
  Object.freeze({
    version: 4,
    sql: `
      CREATE TABLE skill_files (
        id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
        path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 200),
        content TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 262144),
        content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (version_id, path)
      ) STRICT;

      CREATE INDEX skill_files_version_path_idx
        ON skill_files(version_id, path);
    `
  }),
  Object.freeze({
    version: 5,
    sql: `
      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'published', 'withdrawn', 'archived')),
        visibility TEXT NOT NULL DEFAULT 'private'
          CHECK (visibility IN ('private', 'team')),
        current_version_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (id, current_version_id)
          REFERENCES knowledge_versions(document_id, id)
      ) STRICT;

      CREATE INDEX knowledge_documents_owner_idx
        ON knowledge_documents(owner_user_id, status, updated_at DESC);
      CREATE INDEX knowledge_documents_visibility_idx
        ON knowledge_documents(visibility, status, updated_at DESC);

      CREATE TABLE knowledge_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL CHECK (version_number >= 1),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        category TEXT NOT NULL DEFAULT '' CHECK (length(category) <= 100),
        tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
        markdown TEXT NOT NULL CHECK (length(markdown) BETWEEN 1 AND 1048576),
        is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
        created_at TEXT NOT NULL,
        created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (document_id, version_number),
        UNIQUE (document_id, id)
      ) STRICT;

      CREATE UNIQUE INDEX knowledge_versions_current_idx
        ON knowledge_versions(document_id) WHERE is_current = 1;
      CREATE INDEX knowledge_versions_document_idx
        ON knowledge_versions(document_id, version_number DESC);

      CREATE VIRTUAL TABLE knowledge_fts USING fts5(
        document_id UNINDEXED,
        version_id UNINDEXED,
        title,
        category,
        tags,
        markdown,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TABLE solutions (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'published', 'withdrawn', 'archived')),
        visibility TEXT NOT NULL DEFAULT 'private'
          CHECK (visibility IN ('private', 'team')),
        current_version_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (id, current_version_id)
          REFERENCES solution_versions(solution_id, id)
      ) STRICT;

      CREATE INDEX solutions_owner_idx
        ON solutions(owner_user_id, status, updated_at DESC);
      CREATE INDEX solutions_visibility_idx
        ON solutions(visibility, status, updated_at DESC);

      CREATE TABLE solution_versions (
        id TEXT PRIMARY KEY,
        solution_id TEXT NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL CHECK (version_number >= 1),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
        solution_markdown TEXT NOT NULL DEFAULT '' CHECK (length(solution_markdown) <= 1048576),
        is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
        created_at TEXT NOT NULL,
        created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (solution_id, version_number),
        UNIQUE (solution_id, id)
      ) STRICT;

      CREATE UNIQUE INDEX solution_versions_current_idx
        ON solution_versions(solution_id) WHERE is_current = 1;
      CREATE INDEX solution_versions_solution_idx
        ON solution_versions(solution_id, version_number DESC);

      CREATE TABLE content_references (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK (source_type IN ('conversation', 'knowledge_version', 'skill_version', 'model')),
        source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
        knowledge_version_id TEXT REFERENCES knowledge_versions(id) ON DELETE CASCADE,
        solution_version_id TEXT REFERENCES solution_versions(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        CHECK ((knowledge_version_id IS NOT NULL) != (solution_version_id IS NOT NULL)),
        UNIQUE (source_type, source_id, knowledge_version_id, solution_version_id)
      ) STRICT;

      CREATE INDEX content_references_knowledge_idx ON content_references(knowledge_version_id);
      CREATE INDEX content_references_solution_idx ON content_references(solution_version_id);
    `
  })
]);

module.exports = { MIGRATIONS };
