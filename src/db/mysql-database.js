'use strict';

const mysql = require('mysql2/promise');

function databaseError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function parseMySqlUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw databaseError('MYSQL_URL_REQUIRED', 'MySQL URL is required');
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw databaseError('MYSQL_URL_INVALID', 'MySQL URL is invalid'); }
  if (!['mysql:', 'mysqls:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    throw databaseError('MYSQL_URL_INVALID', 'MySQL URL is invalid');
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    ssl: parsed.protocol === 'mysqls:' ? {} : undefined
  };
}

function createExecutor(executor) {
  async function query(sql, params = []) {
    const [result] = await executor.execute(sql, params);
    return result;
  }
  async function many(sql, params = []) {
    const result = await query(sql, params);
    return Array.isArray(result) ? result : [];
  }
  async function one(sql, params = []) {
    const rows = await many(sql, params);
    return rows[0] || null;
  }
  return { query, many, one };
}

async function createMySqlDatabase({ url, poolSize = 10 } = {}) {
  if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 100) {
    throw databaseError('MYSQL_POOL_SIZE_INVALID', 'MySQL pool size is invalid');
  }
  const connection = parseMySqlUrl(url);
  const pool = mysql.createPool({
    ...connection,
    waitForConnections: true,
    connectionLimit: poolSize,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });
  const base = createExecutor(pool);

  async function health() {
    try {
      const settings = await base.one(`
        SELECT VERSION() AS version, @@character_set_database AS characterSet, @@session.time_zone AS timeZone,
          @@ngram_token_size AS ngramTokenSize
      `);
      const plugin = await base.one(`
        SELECT PLUGIN_STATUS AS status FROM information_schema.PLUGINS WHERE PLUGIN_NAME = 'ngram'
      `);
      return {
        version: String(settings?.version || ''),
        characterSet: String(settings?.characterSet || ''),
        timeZone: String(settings?.timeZone || ''),
        ngramParser: plugin?.status === 'ACTIVE',
        ngramTokenSize: Number(settings?.ngramTokenSize || 0)
      };
    } catch (error) {
      throw databaseError('MYSQL_UNAVAILABLE', 'MySQL is unavailable', error);
    }
  }

  async function transaction(operation) {
    if (typeof operation !== 'function') throw new TypeError('transaction operation is required');
    const client = await pool.getConnection();
    try {
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await client.beginTransaction();
      const result = await operation(createExecutor(client));
      await client.commit();
      return result;
    } catch (error) {
      await client.rollback().catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function assertCapabilities() {
    const result = await health();
    const supported = /^8\.4\./.test(result.version)
      && result.characterSet === 'utf8mb4'
      && result.timeZone === '+00:00'
      && result.ngramParser === true
      && result.ngramTokenSize === 2;
    if (!supported) {
      throw databaseError('MYSQL_CAPABILITY_MISMATCH', 'MySQL capabilities are incompatible');
    }
    return result;
  }

  async function withMigrationLock(operation, { timeoutSeconds = 30 } = {}) {
    if (typeof operation !== 'function') throw new TypeError('migration operation is required');
    const client = await pool.getConnection();
    const lockName = 'opencode_workbench_schema_migration';
    try {
      const [[lock]] = await client.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, timeoutSeconds]);
      if (Number(lock?.acquired) !== 1) {
        throw databaseError('MYSQL_MIGRATION_LOCK_TIMEOUT', 'MySQL migration lock timed out');
      }
      return await operation(createExecutor(client));
    } finally {
      await client.query('DO RELEASE_LOCK(?)', [lockName]).catch(() => {});
      client.release();
    }
  }

  return Object.freeze({
    ...base,
    health,
    assertCapabilities,
    transaction,
    withMigrationLock,
    close: () => pool.end()
  });
}

module.exports = { createMySqlDatabase, parseMySqlUrl };
