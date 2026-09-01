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

function loadConfig({ env = process.env, projectDir }) {
  const root = path.resolve(env.WORKBENCH_ROOT || projectDir);

  return Object.freeze({
    projectDir: root,
    port: positiveInteger(env.PORT, 3000, 'PORT'),
    maxSessions: positiveInteger(env.MAX_SESSIONS, 20, 'MAX_SESSIONS'),
    opencodeTimeoutMs: positiveInteger(env.OPENCODE_TIMEOUT_MS, 120000, 'OPENCODE_TIMEOUT_MS'),
    opencodeMaxOutputBytes: positiveInteger(env.OPENCODE_MAX_OUTPUT_BYTES, 10 * 1024 * 1024, 'OPENCODE_MAX_OUTPUT_BYTES'),
    opencodeCmd: env.OPENCODE_CMD || path.join(env.HOME || '', '.opencode/bin/opencode'),
    opencodeCwd: path.resolve(env.OPENCODE_CWD || root),
    knowledgeDir: path.resolve(env.KNOWLEDGE_DIR || path.join(root, 'knowledge')),
    solutionsDir: path.resolve(env.SOLUTIONS_DIR || path.join(root, 'solutions')),
    skillsDir: path.resolve(env.SKILLS_DIR || path.join(root, '.opencode/skills')),
    databasePath: path.resolve(env.DATABASE_PATH || path.join(root, 'data/workbench.db')),
    uploadTempDir: path.resolve(env.UPLOAD_TEMP_DIR || path.join(root, 'data/tmp/uploads')),
    fetchAllowedHosts: parseHostList(env.KNOWLEDGE_FETCH_ALLOWED_HOSTS || '')
  });
}

module.exports = { loadConfig };
