'use strict';

const MYSQL_MIGRATIONS = Object.freeze([
  Object.freeze({ version: 1, statements: [
    `CREATE TABLE users (
      id VARCHAR(200) PRIMARY KEY, username VARCHAR(32) NOT NULL UNIQUE,
      display_name VARCHAR(80) NOT NULL, password_hash TEXT NOT NULL,
      role ENUM('admin','member') NOT NULL, status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      session_version BIGINT NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL, last_login_at DATETIME(3) NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE login_sessions (
      id VARCHAR(200) PRIMARY KEY, user_id VARCHAR(200) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE,
      csrf_token_hash CHAR(64) NOT NULL, session_version BIGINT NOT NULL, created_at DATETIME(3) NOT NULL,
      last_seen_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL, revoked_at DATETIME(3) NULL,
      source_ip VARCHAR(128) NULL, user_agent VARCHAR(512) NULL,
      CONSTRAINT login_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX login_sessions_user_id_idx (user_id), INDEX login_sessions_expiry_idx (expires_at)
    ) ENGINE=InnoDB`,
    `CREATE TABLE audit_logs (
      id VARCHAR(200) PRIMARY KEY, actor_user_id VARCHAR(200) NULL, action VARCHAR(200) NOT NULL,
      target_type VARCHAR(200) NOT NULL, target_id VARCHAR(200) NULL, metadata_json JSON NOT NULL,
      source_ip VARCHAR(128) NULL, created_at DATETIME(3) NOT NULL,
      CONSTRAINT audit_logs_actor_fk FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX audit_logs_actor_idx (actor_user_id, created_at), INDEX audit_logs_action_idx (action, created_at)
    ) ENGINE=InnoDB`
  ] }),
  Object.freeze({ version: 2, statements: [
    `CREATE TABLE conversations (
      id VARCHAR(200) PRIMARY KEY, owner_user_id VARCHAR(200) NOT NULL, title VARCHAR(200) NOT NULL,
      status ENUM('active','archived') NOT NULL DEFAULT 'active', default_model VARCHAR(200) NULL,
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      CONSTRAINT conversations_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX conversations_owner_status_idx (owner_user_id, status, updated_at DESC)
    ) ENGINE=InnoDB`,
    `CREATE TABLE gateway_workers (
      id VARCHAR(200) PRIMARY KEY, instance_id VARCHAR(200) NOT NULL UNIQUE,
      status ENUM('starting','healthy','unhealthy','stopping','stopped') NOT NULL,
      endpoint VARCHAR(500) NULL, process_id BIGINT NULL, version VARCHAR(100) NULL,
      capacity INT NOT NULL DEFAULT 1, last_heartbeat_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      CHECK (capacity BETWEEN 1 AND 16), INDEX gateway_workers_status_idx (status, updated_at)
    ) ENGINE=InnoDB`,
    `CREATE TABLE opencode_sessions (
      id VARCHAR(200) PRIMARY KEY, conversation_id VARCHAR(200) NOT NULL UNIQUE,
      opencode_session_id VARCHAR(200) NOT NULL UNIQUE, worker_id VARCHAR(200) NULL,
      workspace_path VARCHAR(1024) NOT NULL, workspace_path_sha256 CHAR(64) NOT NULL UNIQUE,
      recovery_status ENUM('active','recovering','interrupted','unavailable') NOT NULL,
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      CONSTRAINT opencode_sessions_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      CONSTRAINT opencode_sessions_worker_fk FOREIGN KEY (worker_id) REFERENCES gateway_workers(id) ON DELETE SET NULL,
      INDEX opencode_sessions_worker_idx (worker_id, recovery_status)
    ) ENGINE=InnoDB`,
    `CREATE TABLE gateway_jobs (
      id VARCHAR(200) PRIMARY KEY, conversation_id VARCHAR(200) NOT NULL, user_id VARCHAR(200) NOT NULL,
      opencode_session_binding_id VARCHAR(200) NULL, worker_id VARCHAR(200) NULL,
      idempotency_key VARCHAR(200) NOT NULL, input_text MEDIUMTEXT NOT NULL,
      status ENUM('queued','running','completed','failed','cancelled','interrupted','timed_out') NOT NULL,
      error_code VARCHAR(100) NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      started_at DATETIME(3) NULL, finished_at DATETIME(3) NULL,
      CONSTRAINT gateway_jobs_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      CONSTRAINT gateway_jobs_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT gateway_jobs_binding_fk FOREIGN KEY (opencode_session_binding_id) REFERENCES opencode_sessions(id) ON DELETE SET NULL,
      CONSTRAINT gateway_jobs_worker_fk FOREIGN KEY (worker_id) REFERENCES gateway_workers(id) ON DELETE SET NULL,
      UNIQUE KEY gateway_jobs_idempotency_uq (user_id, idempotency_key),
      INDEX gateway_jobs_schedule_idx (status, created_at, id),
      INDEX gateway_jobs_user_status_idx (user_id, status, created_at),
      INDEX gateway_jobs_conversation_status_idx (conversation_id, status, created_at)
    ) ENGINE=InnoDB`,
    `CREATE TABLE gateway_events (
      sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, conversation_id VARCHAR(200) NOT NULL,
      job_id VARCHAR(200) NULL, type VARCHAR(100) NOT NULL, payload_json JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      CONSTRAINT gateway_events_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      CONSTRAINT gateway_events_job_fk FOREIGN KEY (job_id) REFERENCES gateway_jobs(id) ON DELETE CASCADE,
      INDEX gateway_events_conversation_sequence_idx (conversation_id, sequence),
      INDEX gateway_events_job_sequence_idx (job_id, sequence)
    ) ENGINE=InnoDB`
  ] }),
  Object.freeze({ version: 3, statements: [
    `CREATE TABLE skills (
      id VARCHAR(200) PRIMARY KEY, owner_user_id VARCHAR(200) NOT NULL, slug VARCHAR(64) NOT NULL UNIQUE,
      display_name VARCHAR(100) NOT NULL, description VARCHAR(500) NOT NULL DEFAULT '',
      status ENUM('draft','published','disabled','archived') NOT NULL DEFAULT 'draft',
      visibility ENUM('private','team') NOT NULL DEFAULT 'private', created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      CONSTRAINT skills_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      INDEX skills_owner_status_idx (owner_user_id, status, updated_at DESC),
      INDEX skills_visibility_status_idx (visibility, status, updated_at DESC)
    ) ENGINE=InnoDB`,
    `CREATE TABLE skill_versions (
      id VARCHAR(200) PRIMARY KEY, skill_id VARCHAR(200) NOT NULL, version VARCHAR(32) NOT NULL,
      status ENUM('draft','validated','published','retired') NOT NULL DEFAULT 'draft', skill_md MEDIUMTEXT NOT NULL,
      validation_report_json JSON NOT NULL, content_sha256 CHAR(64) NULL, created_by_user_id VARCHAR(200) NULL,
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, published_at DATETIME(3) NULL,
      CONSTRAINT skill_versions_skill_fk FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      CONSTRAINT skill_versions_creator_fk FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY skill_versions_skill_version_uq (skill_id, version),
      UNIQUE KEY skill_versions_skill_id_uq (skill_id, id),
      INDEX skill_versions_skill_status_idx (skill_id, status, created_at DESC)
    ) ENGINE=InnoDB`,
    `CREATE TABLE skill_installations (
      id VARCHAR(200) PRIMARY KEY, user_id VARCHAR(200) NOT NULL, skill_id VARCHAR(200) NOT NULL,
      version_id VARCHAR(200) NOT NULL, status ENUM('installed','enabled','disabled') NOT NULL DEFAULT 'installed',
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      CONSTRAINT skill_installations_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT skill_installations_skill_fk FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      CONSTRAINT skill_installations_version_fk FOREIGN KEY (skill_id, version_id) REFERENCES skill_versions(skill_id, id) ON DELETE RESTRICT,
      UNIQUE KEY skill_installations_user_skill_uq (user_id, skill_id),
      INDEX skill_installations_user_status_idx (user_id, status, updated_at DESC)
    ) ENGINE=InnoDB`
  ] }),
  Object.freeze({ version: 4, statements: [
    `CREATE TABLE skill_files (
      id VARCHAR(200) PRIMARY KEY, version_id VARCHAR(200) NOT NULL, path VARCHAR(200) NOT NULL,
      content MEDIUMTEXT NOT NULL, size_bytes INT NOT NULL, content_sha256 CHAR(64) NOT NULL,
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      CONSTRAINT skill_files_version_fk FOREIGN KEY (version_id) REFERENCES skill_versions(id) ON DELETE CASCADE,
      UNIQUE KEY skill_files_version_path_uq (version_id, path),
      INDEX skill_files_version_path_idx (version_id, path)
    ) ENGINE=InnoDB`
  ] }),
  Object.freeze({ version: 5, statements: [
    `CREATE TABLE knowledge_documents (
      id VARCHAR(200) PRIMARY KEY, owner_user_id VARCHAR(200) NOT NULL,
      status ENUM('draft','published','withdrawn','archived') NOT NULL DEFAULT 'draft',
      visibility ENUM('private','team') NOT NULL DEFAULT 'private', current_version_id VARCHAR(200) NULL,
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      CONSTRAINT knowledge_documents_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      INDEX knowledge_documents_owner_idx (owner_user_id, status, updated_at DESC),
      INDEX knowledge_documents_visibility_idx (visibility, status, updated_at DESC)
    ) ENGINE=InnoDB`,
    `CREATE TABLE knowledge_versions (
      id VARCHAR(200) PRIMARY KEY, document_id VARCHAR(200) NOT NULL, version_number INT NOT NULL,
      title VARCHAR(200) NOT NULL, category VARCHAR(100) NOT NULL DEFAULT '', tags_json JSON NOT NULL,
      markdown MEDIUMTEXT NOT NULL, is_current BOOLEAN NOT NULL DEFAULT FALSE,
      current_document_id VARCHAR(200) NULL,
      created_at DATETIME(3) NOT NULL, created_by_user_id VARCHAR(200) NULL,
      CONSTRAINT knowledge_versions_document_fk FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      CONSTRAINT knowledge_versions_creator_fk FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY knowledge_versions_document_number_uq (document_id, version_number),
      UNIQUE KEY knowledge_versions_document_id_uq (document_id, id),
      UNIQUE KEY knowledge_versions_current_uq (current_document_id),
      CONSTRAINT knowledge_versions_current_document_ck CHECK (
        (is_current = 1 AND current_document_id = document_id) OR
        (is_current = 0 AND current_document_id IS NULL)
      ),
      INDEX knowledge_versions_document_idx (document_id, version_number DESC),
      FULLTEXT KEY knowledge_fulltext_idx (title, category, markdown) WITH PARSER ngram
    ) ENGINE=InnoDB`,
    `ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_documents_current_fk
      FOREIGN KEY (id, current_version_id) REFERENCES knowledge_versions(document_id, id)`,
    `CREATE TABLE solutions (
      id VARCHAR(200) PRIMARY KEY, owner_user_id VARCHAR(200) NOT NULL,
      status ENUM('draft','published','withdrawn','archived') NOT NULL DEFAULT 'draft',
      visibility ENUM('private','team') NOT NULL DEFAULT 'private', current_version_id VARCHAR(200) NULL,
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      CONSTRAINT solutions_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      INDEX solutions_owner_idx (owner_user_id, status, updated_at DESC),
      INDEX solutions_visibility_idx (visibility, status, updated_at DESC)
    ) ENGINE=InnoDB`,
    `CREATE TABLE solution_versions (
      id VARCHAR(200) PRIMARY KEY, solution_id VARCHAR(200) NOT NULL, version_number INT NOT NULL,
      title VARCHAR(200) NOT NULL, description TEXT NOT NULL, solution_markdown MEDIUMTEXT NOT NULL,
      is_current BOOLEAN NOT NULL DEFAULT FALSE,
      current_solution_id VARCHAR(200) NULL,
      created_at DATETIME(3) NOT NULL, created_by_user_id VARCHAR(200) NULL,
      CONSTRAINT solution_versions_solution_fk FOREIGN KEY (solution_id) REFERENCES solutions(id) ON DELETE CASCADE,
      CONSTRAINT solution_versions_creator_fk FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY solution_versions_solution_number_uq (solution_id, version_number),
      UNIQUE KEY solution_versions_solution_id_uq (solution_id, id),
      UNIQUE KEY solution_versions_current_uq (current_solution_id),
      CONSTRAINT solution_versions_current_solution_ck CHECK (
        (is_current = 1 AND current_solution_id = solution_id) OR
        (is_current = 0 AND current_solution_id IS NULL)
      ),
      INDEX solution_versions_solution_idx (solution_id, version_number DESC)
    ) ENGINE=InnoDB`,
    `ALTER TABLE solutions ADD CONSTRAINT solutions_current_fk
      FOREIGN KEY (id, current_version_id) REFERENCES solution_versions(solution_id, id)`,
    `CREATE TABLE content_references (
      id VARCHAR(200) PRIMARY KEY,
      source_type ENUM('conversation','knowledge_version','solution_version','skill_version','model') NOT NULL,
      source_id VARCHAR(200) NOT NULL, target_type ENUM('knowledge_version','solution_version') NOT NULL,
      target_id VARCHAR(200) NOT NULL, knowledge_version_id VARCHAR(200) NULL, solution_version_id VARCHAR(200) NULL,
      created_at DATETIME(3) NOT NULL,
      CONSTRAINT content_references_knowledge_fk FOREIGN KEY (knowledge_version_id) REFERENCES knowledge_versions(id) ON DELETE CASCADE,
      CONSTRAINT content_references_solution_fk FOREIGN KEY (solution_version_id) REFERENCES solution_versions(id) ON DELETE CASCADE,
      CONSTRAINT content_references_one_target_ck CHECK (
        (target_type = 'knowledge_version' AND target_id = knowledge_version_id AND solution_version_id IS NULL) OR
        (target_type = 'solution_version' AND target_id = solution_version_id AND knowledge_version_id IS NULL)
      ),
      UNIQUE KEY content_references_uq (source_type, source_id, target_type, target_id),
      INDEX content_references_knowledge_idx (knowledge_version_id),
      INDEX content_references_solution_idx (solution_version_id)
    ) ENGINE=InnoDB`
  ] }),
  Object.freeze({ version: 6, statements: [
    `CREATE TABLE conversation_reference_details (
      content_reference_id VARCHAR(200) PRIMARY KEY, conversation_id VARCHAR(200) NOT NULL,
      first_sequence BIGINT UNSIGNED NOT NULL, last_sequence BIGINT UNSIGNED NOT NULL,
      completed_turn_count INT UNSIGNED NOT NULL, content_sha256 CHAR(64) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      CONSTRAINT conversation_reference_details_reference_fk FOREIGN KEY (content_reference_id) REFERENCES content_references(id) ON DELETE CASCADE,
      CONSTRAINT conversation_reference_details_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      CHECK (last_sequence >= first_sequence), CHECK (completed_turn_count >= 1),
      INDEX conversation_reference_details_conversation_idx (conversation_id, last_sequence)
    ) ENGINE=InnoDB`
  ] }),
  Object.freeze({ version: 7, statements: [
    `ALTER TABLE content_references MODIFY source_type ENUM('conversation','knowledge_version','solution_version','skill_version','model') NOT NULL`
  ] })
]);

module.exports = { MYSQL_MIGRATIONS };
