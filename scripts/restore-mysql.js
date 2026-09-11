#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseMySqlUrl } = require('../src/db/mysql-database');

function parseArgs(argv) {
  const values = { url: process.env.WORKBENCH_DATABASE_URL, confirm: false };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--confirm') { values.confirm = true; continue; }
    const value = argv[index + 1];
    if (!['--url', '--input', '--mysql-bin'].includes(key) || !value || value.startsWith('--')) {
      throw new Error('usage: restore-mysql.js [--url <mysql-url>] --input <path> --confirm [--mysql-bin <path>]');
    }
    values[key.slice(2)] = value;
    index += 1;
  }
  if (!values.url || !values.input || !values.confirm) throw new Error('MySQL URL, input and --confirm are required');
  return { ...values, input: path.resolve(values.input), mysqlBin: values.mysqlBin || 'mysql' };
}

function main(argv = process.argv, { spawnSyncImpl = spawnSync } = {}) {
  const { url, input, mysqlBin } = parseArgs(argv);
  const connection = parseMySqlUrl(url);
  if (!fs.existsSync(input)) throw new Error('backup input does not exist');
  const manifestPath = `${input}.manifest.json`;
  if (!fs.existsSync(manifestPath)) throw new Error('backup manifest is required');
  const dump = fs.readFileSync(input);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.schemaVersion !== 1 || manifest.sizeBytes !== dump.length || manifest.sha256 !== crypto.createHash('sha256').update(dump).digest('hex')) {
    throw new Error('backup manifest digest mismatch');
  }
  const result = spawnSyncImpl(mysqlBin, [
    '--host', connection.host, '--port', String(connection.port), '--user', connection.user, connection.database
  ], {
    env: { ...process.env, MYSQL_PWD: connection.password },
    input: dump,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw new Error(`mysql could not be started: ${result.error.message}`);
  if (result.status !== 0) throw new Error('mysql restore failed');
  return input;
}

if (require.main === module) {
  try { console.log(`MySQL restore completed from: ${main()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { parseArgs, main };
