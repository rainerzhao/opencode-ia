'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkbenchServer } = require('../../src/create-workbench-server');

test('accepts an injected asynchronous repository set without opening or migrating SQLite', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-composition-'));
  const config = {
    projectDir: root,
    staticDir: path.join(root, 'static'),
    port: 0,
    maxSessions: 4,
    opencodeCwd: root,
    knowledgeDir: path.join(root, 'knowledge'),
    solutionsDir: path.join(root, 'solutions'),
    skillsDir: path.join(root, 'skills'),
    skillInstallRoot: path.join(root, 'skill-installations'),
    contentAttachmentRoot: path.join(root, 'content-attachments'),
    uploadTempDir: path.join(root, 'uploads'),
    cookieSecure: false,
    sessionTtlSeconds: 3600,
    loginMaxFailures: 5,
    loginWindowSeconds: 900,
    loginLockSeconds: 900
  };
  const database = { close() { this.closed = true; } };
  const authService = {
    async authenticate() { const error = new Error('Authentication is required'); error.code = 'SESSION_INVALID'; error.status = 401; throw error; },
    async login() { throw new Error('unused'); },
    async logout() {},
    async changePassword() {},
    async createUser() {},
    async listUsers() { return []; },
    async resetPassword() {},
    async setUserStatus() {},
    async revokeUserSessions() {}
  };
  const repositories = {
    authService,
    requestAuditor: { record() {} },
    gatewayStore: { listEventsAfter() { return []; } },
    skillStore: {
      getValidationCandidate() {}, saveValidationReport() {}, getPublishedInstallCandidate() {},
      recordInstallation() {}, listInstallations() {}, setInstallationStatus() {}, listEnabledInstallations() { return []; }
    },
    contentStore: {
      createSolutionFromConversation() {}, createKnowledgeAttachment() {}, getKnowledgeAttachment() {}
    }
  };
  fs.mkdirSync(config.staticDir, { recursive: true });
  const workbench = createWorkbenchServer({
    config,
    database,
    repositories,
    promptRunner: { runPrompt: async () => ({ text: 'unused' }) },
    logger: { log() {}, error() {} }
  });
  t.after(async () => {
    await workbench.stop().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });
  const address = await workbench.start(0, '127.0.0.1');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`);
  assert.equal(response.status, 401);
  assert.equal(database.closed, undefined);
  assert.equal(workbench.database, database);
});
