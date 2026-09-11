#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseMySqlUrl } = require('../src/db/mysql-database');

function parseArgs(argv) {
  const values = { url: process.env.WORKBENCH_DATABASE_URL };
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--url', '--output', '--mysqldump-bin'].includes(key) || !value || value.startsWith('--')) {
      throw new Error('usage: backup-mysql.js [--url <mysql-url>] --output <path> [--mysqldump-bin <path>]');
    }
    values[key.slice(2)] = value;
  }
  if (!values.url || !values.output) throw new Error('MySQL URL and output are required');
  return { ...values, output: path.resolve(values.output), mysqldumpBin: values.mysqldumpBin || 'mysqldump' };
}

function main(argv = process.argv, { spawnSyncImpl = spawnSync, clock = () => new Date().toISOString() } = {}) {
  const { url, output, mysqldumpBin } = parseArgs(argv);
  const connection = parseMySqlUrl(url);
  if (fs.existsSync(output) || fs.existsSync(`${output}.manifest.json`)) throw new Error('backup output already exists');
  const temporary = `${output}.partial`;
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const args = [
    '--host', connection.host, '--port', String(connection.port), '--user', connection.user,
    '--single-transaction', '--routines', '--triggers', '--set-gtid-purged=OFF', connection.database
  ];
  const result = spawnSyncImpl(mysqldumpBin, args, {
    env: { ...process.env, MYSQL_PWD: connection.password },
    encoding: null,
    maxBuffer: 512 * 1024 * 1024
  });
  try {
    if (result.error) throw new Error(`mysqldump could not be started: ${result.error.message}`);
    if (result.status !== 0) throw new Error('mysqldump failed');
    const dump = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
    if (!dump.length) throw new Error('mysqldump returned an empty backup');
    fs.writeFileSync(temporary, dump, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, output);
    const digest = crypto.createHash('sha256').update(dump).digest('hex');
    fs.writeFileSync(`${output}.manifest.json`, JSON.stringify({
      schemaVersion: 1,
      createdAt: clock(),
      database: connection.database,
      host: connection.host,
      sizeBytes: dump.length,
      sha256: digest
    }, null, 2), { mode: 0o600, flag: 'wx' });
    fs.chmodSync(output, 0o600);
    return output;
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    try { fs.rmSync(output, { force: true }); } catch {}
    try { fs.rmSync(`${output}.manifest.json`, { force: true }); } catch {}
    throw error;
  }
}

if (require.main === module) {
  try { console.log(`MySQL backup created: ${main()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { parseArgs, main };
