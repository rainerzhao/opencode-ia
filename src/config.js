const path = require('node:path');

function positiveInteger(value, defaultValue, name) {
  if (value === undefined) return defaultValue;

  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseHostList(value) {
  return Object.freeze(value.split(',').map((host) => host.trim()).filter(Boolean));
}

function boundedPositiveInteger(value, defaultValue, name, max) {
  const parsed = positiveInteger(value, defaultValue, name);
  if (parsed > max) throw new Error(`${name} must be at most ${max}`);
  return parsed;
}

function safeToken(value, defaultValue, name) {
  const token = value === undefined ? defaultValue : value;
  if (typeof token !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(token)) {
    throw new Error(`${name} contains unsafe characters`);
  }
  return token;
}

function booleanValue(value, defaultValue, name) {
  if (value === undefined) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function loadConfig({ env = process.env, projectDir }) {
  const root = path.resolve(env.WORKBENCH_ROOT || projectDir);

  return Object.freeze({
    projectDir: root,
    staticDir: path.resolve(env.WEB_DIST_DIR || path.join(root, 'dist/web')),
    port: positiveInteger(env.PORT, 3000, 'PORT'),
    maxSessions: positiveInteger(env.MAX_SESSIONS, 20, 'MAX_SESSIONS'),
    opencodeTimeoutMs: positiveInteger(env.OPENCODE_TIMEOUT_MS, 120000, 'OPENCODE_TIMEOUT_MS'),
    opencodeMaxOutputBytes: positiveInteger(env.OPENCODE_MAX_OUTPUT_BYTES, 10 * 1024 * 1024, 'OPENCODE_MAX_OUTPUT_BYTES'),
    opencodeCmd: env.OPENCODE_CMD || path.join(env.HOME || '', '.opencode/bin/opencode'),
    opencodeCwd: path.resolve(env.OPENCODE_CWD || root),
    opencodeWorkerBasePort: boundedPositiveInteger(
      env.OPENCODE_WORKER_BASE_PORT,
      4319,
      'OPENCODE_WORKER_BASE_PORT',
      65535
    ),
    opencodeWorkerStartupTimeoutMs: positiveInteger(
      env.OPENCODE_WORKER_STARTUP_TIMEOUT_MS,
      10000,
      'OPENCODE_WORKER_STARTUP_TIMEOUT_MS'
    ),
    opencodeWorkerReadinessIntervalMs: positiveInteger(
      env.OPENCODE_WORKER_READINESS_INTERVAL_MS,
      100,
      'OPENCODE_WORKER_READINESS_INTERVAL_MS'
    ),
    opencodeWorkerStopGraceMs: positiveInteger(
      env.OPENCODE_WORKER_STOP_GRACE_MS,
      2000,
      'OPENCODE_WORKER_STOP_GRACE_MS'
    ),
    opencodeWorkerKillGraceMs: positiveInteger(
      env.OPENCODE_WORKER_KILL_GRACE_MS,
      1000,
      'OPENCODE_WORKER_KILL_GRACE_MS'
    ),
    opencodeWorkerUsername: safeToken(
      env.OPENCODE_WORKER_USERNAME,
      'opencode',
      'OPENCODE_WORKER_USERNAME'
    ),
    opencodeVerifiedVersion: safeToken(
      env.OPENCODE_VERIFIED_VERSION,
      '1.18.25',
      'OPENCODE_VERIFIED_VERSION'
    ),
    knowledgeDir: path.resolve(env.KNOWLEDGE_DIR || path.join(root, 'knowledge')),
    solutionsDir: path.resolve(env.SOLUTIONS_DIR || path.join(root, 'solutions')),
    skillsDir: path.resolve(env.SKILLS_DIR || path.join(root, '.opencode/skills')),
    databasePath: path.resolve(env.DATABASE_PATH || path.join(root, 'data/workbench.db')),
    uploadTempDir: path.resolve(env.UPLOAD_TEMP_DIR || path.join(root, 'data/tmp/uploads')),
    fetchAllowedHosts: parseHostList(env.KNOWLEDGE_FETCH_ALLOWED_HOSTS || ''),
    cookieSecure: booleanValue(env.COOKIE_SECURE, env.NODE_ENV === 'production', 'COOKIE_SECURE'),
    sessionTtlSeconds: positiveInteger(env.SESSION_TTL_SECONDS, 8 * 60 * 60, 'SESSION_TTL_SECONDS'),
    loginMaxFailures: positiveInteger(env.LOGIN_MAX_FAILURES, 5, 'LOGIN_MAX_FAILURES'),
    loginWindowSeconds: positiveInteger(env.LOGIN_WINDOW_SECONDS, 15 * 60, 'LOGIN_WINDOW_SECONDS'),
    loginLockSeconds: positiveInteger(env.LOGIN_LOCK_SECONDS, 15 * 60, 'LOGIN_LOCK_SECONDS')
  });
}

module.exports = { loadConfig };
