'use strict';

const { parseMySqlUrl } = require('../../src/db/mysql-database');

const TABLES_IN_DROP_ORDER = Object.freeze([
  'content_references',
  'skill_files',
  'skill_installations',
  'knowledge_versions',
  'knowledge_documents',
  'solution_versions',
  'solutions',
  'skill_versions',
  'skills',
  'gateway_events',
  'gateway_jobs',
  'opencode_sessions',
  'gateway_workers',
  'conversations',
  'audit_logs',
  'login_sessions',
  'users',
  'schema_migrations'
]);

function assertDedicatedMySqlTestUrl(url = process.env.WORKBENCH_TEST_MYSQL_URL) {
  const parsed = parseMySqlUrl(url);
  const isLoopback = parsed.host === '127.0.0.1' || parsed.host === 'localhost' || parsed.host === '::1';
  if (!isLoopback || !/test/i.test(parsed.database)) {
    const error = new Error('MySQL reset requires a loopback database whose name includes "test"');
    error.code = 'MYSQL_TEST_DATABASE_REQUIRED';
    throw error;
  }
  return parsed;
}

async function resetMySqlSchema(db, { url } = {}) {
  assertDedicatedMySqlTestUrl(url);
  await db.withMigrationLock(async (client) => {
    await client.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const table of TABLES_IN_DROP_ORDER) await client.query(`DROP TABLE IF EXISTS \`${table}\``);
    } finally {
      await client.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

async function clearMySqlBusinessData(db, { url } = {}) {
  assertDedicatedMySqlTestUrl(url);
  await db.transaction(async (client) => {
    for (const table of ['gateway_events', 'gateway_jobs', 'opencode_sessions', 'gateway_workers']) {
      await client.query(`DELETE FROM \`${table}\``);
    }
    await client.query('DELETE FROM content_references');
    await client.query('UPDATE knowledge_documents SET current_version_id = NULL');
    await client.query('UPDATE solutions SET current_version_id = NULL');
    for (const table of [
      'knowledge_versions', 'solution_versions', 'knowledge_documents', 'solutions',
      'skill_files', 'skill_installations', 'skill_versions', 'skills',
      'audit_logs', 'login_sessions', 'conversations', 'users'
    ]) {
      await client.query(`DELETE FROM \`${table}\``);
    }
  });
}

module.exports = { assertDedicatedMySqlTestUrl, clearMySqlBusinessData, resetMySqlSchema };
