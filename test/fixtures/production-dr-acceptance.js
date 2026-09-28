'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createMySqlProductionWorkbench } = require('../../apps/server');
const { loadConfig } = require('../../src/config');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { main: backupMySql } = require('../../scripts/backup-mysql');
const { main: restoreMySql } = require('../../scripts/restore-mysql');
const { authHeaders, login, readJson } = require('./authenticated-workbench');

async function requestJson({ origin, path: requestPath, session, operation }) {
  const response = await fetch(`${origin}${requestPath}`, { headers: authHeaders(session) });
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    assert.fail(`${operation} returned HTTP ${response.status}`);
  }
  return readJson(response);
}

async function runProductionDrAcceptance({
  env,
  root,
  recovery,
  memberPassword,
  projectDir,
  logger = { log() {}, error() {} },
  dependencies = {}
}) {
  const deps = {
    backupMySql,
    createMySqlDatabase,
    restoreMySql,
    createMySqlProductionWorkbench,
    login,
    requestJson,
    ...dependencies
  };
  const sourceConfig = loadConfig({ env, projectDir });
  const sourceAttachmentRoot = sourceConfig.contentAttachmentRoot;
  const canaryRelativePath = path.join('acceptance', 'dr-canary.bin');
  const sourceCanaryPath = path.join(sourceAttachmentRoot, canaryRelativePath);
  const canary = crypto.randomBytes(64);
  fs.mkdirSync(path.dirname(sourceCanaryPath), { recursive: true });
  fs.writeFileSync(sourceCanaryPath, canary, { mode: 0o600, flag: 'wx' });

  const backupPath = path.join(root, 'backups', 'production-dr.sql');
  deps.backupMySql([
    'node',
    'backup-mysql.js',
    '--output', backupPath,
    '--attachments', sourceAttachmentRoot
  ], { env });

  const recoveryDataRoot = path.join(root, 'recovery-data');
  const recoveryAttachmentRoot = path.join(recoveryDataRoot, 'content-attachments');
  const recoveryRuntimeRoot = path.join(root, 'recovery-runtime');
  const targetEnv = {
    ...env,
    WORKBENCH_DATABASE_URL: env.WORKBENCH_RECOVERY_DATABASE_URL,
    MYSQL_SSL_CA_FILE: env.WORKBENCH_RECOVERY_MYSQL_SSL_CA_FILE || env.MYSQL_SSL_CA_FILE,
    WORKBENCH_DATA_DIR: recoveryDataRoot,
    CONTENT_ATTACHMENT_ROOT: recoveryAttachmentRoot,
    OPENCODE_CWD: recoveryRuntimeRoot,
    XDG_DATA_HOME: path.join(root, 'recovery-xdg-data'),
    XDG_STATE_HOME: path.join(root, 'recovery-xdg-state'),
    XDG_CONFIG_HOME: path.join(root, 'recovery-xdg-config'),
    XDG_CACHE_HOME: path.join(root, 'recovery-xdg-cache')
  };
  fs.mkdirSync(recoveryRuntimeRoot, { recursive: true });

  const targetDatabase = await deps.createMySqlDatabase({
    url: targetEnv.WORKBENCH_DATABASE_URL,
    poolSize: 1,
    sslCaFile: targetEnv.MYSQL_SSL_CA_FILE || null
  });
  try {
    await targetDatabase.assertCapabilities();
    const targetState = await targetDatabase.one(`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
    `);
    assert.equal(Number(targetState?.count), 0, 'recovery acceptance database must be empty before restore');
  } finally {
    await targetDatabase.close();
  }

  deps.restoreMySql([
    'node',
    'restore-mysql.js',
    '--input', backupPath,
    '--attachments', recoveryAttachmentRoot,
    '--confirm'
  ], { env: targetEnv });

  const workbench = await deps.createMySqlProductionWorkbench({ env: targetEnv, projectDir, logger });
  let started = false;
  try {
    const address = await workbench.start(0, '127.0.0.1');
    started = true;
    const origin = `http://127.0.0.1:${address.port}`;
    const restoredMember = await deps.login(origin, recovery.username, memberPassword);
    assert.equal(restoredMember.response.status, 200, 'member login after database restore failed');
    const restoredConversation = await deps.requestJson({
      origin,
      path: `/api/conversations/${recovery.conversationId}`,
      session: restoredMember,
      operation: 'restored conversation read'
    });
    assert.equal(restoredConversation.conversation.id, recovery.conversationId);
    const restoredHistory = await deps.requestJson({
      origin,
      path: `/api/conversations/${recovery.conversationId}/events?afterSequence=0&limit=1000`,
      session: restoredMember,
      operation: 'restored conversation history read'
    });
    assert.equal(restoredHistory.hasMore, false, 'restored acceptance history exceeded its bounded read');
    const terminalTypes = new Set(['job.completed', 'job.interrupted', 'job.failed']);
    for (const jobId of recovery.acceptedJobIds) {
      const terminals = restoredHistory.events.filter((event) =>
        event.jobId === jobId && terminalTypes.has(event.type)
      );
      assert.equal(terminals.length, 1, 'restored job does not have exactly one terminal event');
    }
    assert.deepEqual(fs.readFileSync(path.join(recoveryAttachmentRoot, canaryRelativePath)), canary);
    return Object.freeze({
      enabled: true,
      databaseRestored: true,
      attachmentRestored: true,
      persistedJobs: recovery.acceptedJobIds.length
    });
  } finally {
    if (started) await workbench.stop();
  }
}

module.exports = { runProductionDrAcceptance };
