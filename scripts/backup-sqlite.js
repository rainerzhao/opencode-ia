#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

function parseArgs(argv) {
  const values = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--database', '--output', '--attachments'].includes(key) || !value || value.startsWith('--')) throw new Error('usage: backup-sqlite.js --database <path> --output <path> [--attachments <dir>]');
    values[key.slice(2)] = path.resolve(value);
  }
  if (!values.database || !values.output || values.database === values.output) throw new Error('database and output must be different paths');
  return values;
}

function copyAttachments(sourceRoot, destinationRoot) {
  if (!fs.existsSync(sourceRoot)) throw new Error('attachment root does not exist');
  const manifest = [];
  function visit(source, relative) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('attachment backup refuses symbolic links');
      const childRelative = path.join(relative, entry.name);
      const child = path.join(source, entry.name);
      if (entry.isDirectory()) visit(child, childRelative);
      else if (entry.isFile()) {
        const content = fs.readFileSync(child);
        const target = path.join(destinationRoot, childRelative);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.copyFileSync(child, target, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(target, 0o600);
        manifest.push({ path: childRelative, sizeBytes: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') });
      }
    }
  }
  fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  visit(sourceRoot, '');
  return manifest.sort((left, right) => left.path.localeCompare(right.path));
}

function main(argv = process.argv) {
  const { database, output, attachments } = parseArgs(argv);
  if (!fs.existsSync(database)) throw new Error('source database does not exist');
  if (fs.existsSync(output)) throw new Error('backup output already exists');
  const attachmentOutput = attachments ? `${output}.attachments` : null;
  const manifestOutput = attachments ? `${output}.manifest.json` : null;
  if (attachmentOutput && (fs.existsSync(attachmentOutput) || fs.existsSync(manifestOutput))) {
    throw new Error('backup attachment output already exists');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  try {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      const result = db.prepare('PRAGMA integrity_check').get();
      if (result.integrity_check !== 'ok') throw new Error('source database failed integrity check');
      db.prepare('VACUUM INTO ?').run(output);
    } finally { db.close(); }
    fs.chmodSync(output, 0o600);
    if (attachments) {
      const manifest = copyAttachments(attachments, attachmentOutput);
      fs.writeFileSync(manifestOutput, JSON.stringify({ schemaVersion: 1, files: manifest }, null, 2), { mode: 0o600, flag: 'wx' });
    }
    const backup = new DatabaseSync(output, { readOnly: true });
    try {
      const result = backup.prepare('PRAGMA integrity_check').get();
      if (result.integrity_check !== 'ok') throw new Error('backup failed integrity check');
    } finally { backup.close(); }
  } catch (error) {
    try { fs.rmSync(output, { force: true }); } catch {}
    if (attachmentOutput) {
      try { fs.rmSync(attachmentOutput, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(manifestOutput, { force: true }); } catch {}
    }
    throw error;
  }
  return output;
}

if (require.main === module) {
  try { console.log(`SQLite backup created: ${main()}`); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { parseArgs, main };
