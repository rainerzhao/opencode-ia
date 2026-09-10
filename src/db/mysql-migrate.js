'use strict';

const { MYSQL_MIGRATIONS } = require('./mysql-migrations');

function migrationError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function validateMigrations(migrations) {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration?.version) || migration.version <= previous || !Array.isArray(migration.statements) || !migration.statements.length) {
      throw new TypeError('MySQL migrations are invalid');
    }
    if (migration.statements.some((statement) => typeof statement !== 'string' || !statement.trim())) {
      throw new TypeError('MySQL migrations are invalid');
    }
    previous = migration.version;
  }
}

async function migrateMySqlDatabase(db, { migrations = MYSQL_MIGRATIONS } = {}) {
  if (!db || typeof db.withMigrationLock !== 'function') throw new TypeError('MySQL database is required');
  validateMigrations(migrations);
  return db.withMigrationLock(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY, applied_at DATETIME(3) NOT NULL
      ) ENGINE=InnoDB
    `);
    const appliedRows = await client.many('SELECT version FROM schema_migrations ORDER BY version');
    const applied = new Set(appliedRows.map((row) => Number(row.version)));
    const known = new Set(migrations.map((migration) => migration.version));
    if (appliedRows.some((row) => Number(row.version) > migrations.at(-1).version)) {
      throw migrationError('DATABASE_SCHEMA_TOO_NEW', 'database schema is newer than this application');
    }
    if (appliedRows.some((row) => !known.has(Number(row.version)))) {
      throw migrationError('DATABASE_SCHEMA_UNKNOWN', 'database schema contains an unknown migration');
    }
    const pending = migrations.filter((migration) => !applied.has(migration.version));
    for (const migration of pending) {
      try {
        for (const statement of migration.statements) await client.query(statement);
        await client.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, UTC_TIMESTAMP(3))', [migration.version]);
      } catch (error) {
        throw migrationError('DATABASE_MIGRATION_FAILED', `migration ${migration.version} failed`, error);
      }
    }
    return { appliedVersions: pending.map((migration) => migration.version) };
  });
}

module.exports = { migrateMySqlDatabase };
