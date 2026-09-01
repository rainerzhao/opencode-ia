'use strict';

const { MIGRATIONS } = require('./migrations');

function validateMigrations(migrations) {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration?.version) || migration.version <= previous) {
      throw new Error('migrations must have strictly increasing positive integer versions');
    }
    if (typeof migration.sql !== 'string' || migration.sql.trim() === '') {
      throw new Error(`migration ${migration.version} must contain SQL`);
    }
    previous = migration.version;
  }
}

function migrateDatabase(db, { migrations = MIGRATIONS } = {}) {
  validateMigrations(migrations);
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedVersions = db.prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => row.version);
  const highestKnownVersion = migrations.at(-1)?.version || 0;
  if (appliedVersions.some((version) => version > highestKnownVersion)) {
    const error = new Error('database schema is newer than this application');
    error.code = 'DATABASE_SCHEMA_TOO_NEW';
    throw error;
  }
  const knownVersions = new Set(migrations.map((migration) => migration.version));
  if (appliedVersions.some((version) => !knownVersions.has(version))) {
    const error = new Error('database schema contains an unknown migration');
    error.code = 'DATABASE_SCHEMA_UNKNOWN';
    throw error;
  }
  const applied = new Set(appliedVersions);
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  if (pending.length === 0) return { appliedVersions: [] };

  const recordMigration = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)'
  );

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const migration of pending) {
      try {
        db.exec(migration.sql);
        recordMigration.run(migration.version, new Date().toISOString());
      } catch (error) {
        const wrapped = new Error(`migration ${migration.version} failed`);
        wrapped.code = 'DATABASE_MIGRATION_FAILED';
        wrapped.cause = error;
        throw wrapped;
      }
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }

  return { appliedVersions: pending.map((migration) => migration.version) };
}

module.exports = { migrateDatabase };
