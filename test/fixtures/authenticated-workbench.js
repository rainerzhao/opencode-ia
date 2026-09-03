'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { bootstrapAdmin } = require('../../src/bootstrap/bootstrap-admin');
const { createWorkbenchServer } = require('../../src/create-workbench-server');

const ADMIN_PASSWORD = 'Admin Password 2026!';
const MEMBER_PASSWORD = 'Member Password 2026!';

function getSetCookies(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

function cookieJar(setCookies) {
  return setCookies.map((header) => header.split(';', 1)[0]).join('; ');
}

function cookieValue(setCookies, name) {
  const prefix = `${name}=`;
  const pair = setCookies
    .map((header) => header.split(';', 1)[0])
    .find((item) => item.startsWith(prefix));
  return pair ? decodeURIComponent(pair.slice(prefix.length)) : null;
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function login(origin, username, password) {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const body = await readJson(response);
  const setCookies = getSetCookies(response);
  return {
    response,
    body,
    cookie: cookieJar(setCookies),
    csrfToken: cookieValue(setCookies, 'workbench_csrf')
  };
}

async function createAuthenticatedWorkbench(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'authenticated-workbench-'));
  const databasePath = path.join(root, 'workbench.db');
  const db = openDatabase({ filename: databasePath });
  migrateDatabase(db);
  await bootstrapAdmin({
    db,
    username: 'admin',
    displayName: 'Administrator',
    password: ADMIN_PASSWORD,
    idFactory: () => 'user-admin'
  });
  const config = {
    projectDir: path.resolve(__dirname, '../..'),
    port: 0,
    maxSessions: options.maxSessions || 4,
    opencodeCwd: root,
    knowledgeDir: path.join(root, 'knowledge'),
    solutionsDir: path.join(root, 'solutions'),
    skillsDir: path.join(root, 'skills'),
    uploadTempDir: path.join(root, 'uploads'),
    fetchAllowedHosts: options.fetchAllowedHosts || [],
    databasePath,
    cookieSecure: false,
    sessionTtlSeconds: 3600,
    loginMaxFailures: 5,
    loginWindowSeconds: 900,
    loginLockSeconds: 900
  };
  for (const directory of [
    config.knowledgeDir,
    config.solutionsDir,
    config.skillsDir,
    config.uploadTempDir
  ]) fs.mkdirSync(directory, { recursive: true });

  const workbench = createWorkbenchServer({
    config,
    database: db,
    promptRunner: options.promptRunner || {
      runPrompt: async () => ({ text: 'unused', events: [], stderr: '' })
    },
    logger: options.logger || { log() {}, error() {} },
    urlFetchOptions: options.urlFetchOptions,
    fetchAllowedTextImpl: options.fetchAllowedTextImpl
  });
  const address = await workbench.start(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const admin = await login(origin, 'admin', ADMIN_PASSWORD);

  async function createMember({
    username,
    displayName = username,
    password = MEMBER_PASSWORD
  }) {
    const response = await fetch(`${origin}/api/admin/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: admin.cookie,
        'x-csrf-token': admin.csrfToken
      },
      body: JSON.stringify({ username, displayName, password, role: 'member' })
    });
    const body = await readJson(response);
    if (response.status !== 201) {
      throw new Error(`member fixture failed: ${response.status} ${JSON.stringify(body)}`);
    }
    const session = await login(origin, username, password);
    return { ...session, user: body.user, password };
  }

  t.after(async () => {
    await workbench.stop().catch(() => {});
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  return { root, db, config, workbench, address, origin, admin, createMember };
}

function authHeaders(session, { json = false } = {}) {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    cookie: session.cookie,
    'x-csrf-token': session.csrfToken
  };
}

module.exports = {
  ADMIN_PASSWORD,
  MEMBER_PASSWORD,
  authHeaders,
  createAuthenticatedWorkbench,
  getSetCookies,
  login,
  readJson
};
