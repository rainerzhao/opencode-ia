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
    if (!['--backup', '--output', '--attachments'].includes(key) || !value || value.startsWith('--')) throw new Error('usage: restore-sqlite.js --backup <path> --output <path> [--attachments <dir>]');
    values[key.slice(2)] = path.resolve(value);
  }
  if (!values.backup || !values.output || values.backup === values.output) throw new Error('backup and output must be different paths');
  return values;
}

function readAndVerifyManifest(backup, attachments) {
  const sidecar = `${backup}.attachments`;
  const manifestPath = `${backup}.manifest.json`;
  if (!fs.existsSync(sidecar) || !fs.existsSync(manifestPath)) throw new Error('backup attachment sidecar is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('backup attachment manifest is invalid');
  const sidecarRoot = path.resolve(sidecar);
  const targetRoot = path.resolve(attachments);
  const verified = [];
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || file.path.includes('..') || path.isAbsolute(file.path)) throw new Error('backup attachment manifest path is invalid');
    const sourcePath = path.resolve(sidecarRoot, file.path);
    const targetPath = path.resolve(targetRoot, file.path);
    if (!sourcePath.startsWith(`${sidecarRoot}${path.sep}`) || !targetPath.startsWith(`${targetRoot}${path.sep}`)) throw new Error('backup attachment path escapes root');
    const content = fs.readFileSync(sourcePath);
    if (content.length !== file.sizeBytes || crypto.createHash('sha256').update(content).digest('hex') !== file.sha256) throw new Error('backup attachment digest mismatch');
    verified.push({ sourcePath, targetPath });
  }
  return verified;
}

function main(argv = process.argv) {
  const { backup, output, attachments } = parseArgs(argv);
  if (!fs.existsSync(backup)) throw new Error('backup does not exist');
  if (fs.existsSync(output)) throw new Error('restore output already exists; choose a new instance path');
  const source = new DatabaseSync(backup, { readOnly: true });
  try {
    const result = source.prepare('PRAGMA integrity_check').get();
    if (result.integrity_check !== 'ok') throw new Error('backup failed integrity check');
    const version = source.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version;
    if (!Number.isInteger(version) || version < 1) throw new Error('backup schema is invalid');
  } finally { source.close(); }
  const verifiedAttachments = attachments ? readAndVerifyManifest(backup, attachments) : null;
  if (attachments && fs.existsSync(attachments)) throw new Error('restore attachment output already exists; choose a new directory');
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const createdAttachments = [];
  try {
    fs.copyFileSync(backup, output, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(output, 0o600);
    if (verifiedAttachments) {
      for (const { sourcePath, targetPath } of verifiedAttachments) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
        fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(targetPath, 0o600);
        createdAttachments.push(targetPath);
      }
    }
  } catch (error) {
    for (const targetPath of createdAttachments) {
      try { fs.rmSync(targetPath, { force: true }); } catch {}
    }
    if (attachments && fs.existsSync(attachments)) {
      try { fs.rmSync(attachments, { recursive: true, force: true }); } catch {}
    }
    try { fs.rmSync(output, { force: true }); } catch {}
    throw error;
  }
  return output;
}

if (require.main === module) {
  try { console.log(`SQLite restore created: ${main()}`); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { parseArgs, main };
