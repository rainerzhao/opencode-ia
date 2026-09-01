'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase({ filename }) {
  if (typeof filename !== 'string' || filename.trim() === '') {
    throw new TypeError('database filename is required');
  }

  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
  }

  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') fs.chmodSync(path.resolve(filename), 0o600);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

module.exports = { openDatabase };
