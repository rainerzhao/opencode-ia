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
    if (!['--url', '--input', '--attachments', '--mysql-bin'].includes(key) || !value || value.startsWith('--')) {
      throw new Error('usage: restore-mysql.js [--url <mysql-url>] --input <path> [--attachments <dir>] --confirm [--mysql-bin <path>]');
    }
    values[key.slice(2)] = value;
    index += 1;
  }
  if (!values.url || !values.input || !values.confirm) throw new Error('MySQL URL, input and --confirm are required');
  return {
    ...values,
    input: path.resolve(values.input),
    attachments: values.attachments ? path.resolve(values.attachments) : null,
    mysqlBin: values.mysqlBin || 'mysql'
  };
}

function verifyAttachmentManifest(input, attachments) {
  const sidecar = `${input}.attachments`;
  const manifestPath = `${input}.attachments.manifest.json`;
  if (!fs.existsSync(sidecar) || !fs.existsSync(manifestPath)) throw new Error('backup attachment sidecar is missing');
  const sidecarStat = fs.lstatSync(sidecar);
  if (!sidecarStat.isDirectory() || sidecarStat.isSymbolicLink()) throw new Error('backup attachment sidecar is invalid');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { throw new Error('backup attachment manifest is invalid'); }
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('backup attachment manifest is invalid');
  const sidecarRoot = path.resolve(sidecar);
  const targetRoot = path.resolve(attachments);
  const verified = [];
  const paths = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || file.path.length === 0 || file.path.includes('\0') || path.isAbsolute(file.path) || /^[A-Za-z]:[\\/]/.test(file.path) || file.path.split(/[\\/]/).includes('..')) {
      throw new Error('backup attachment manifest path is invalid');
    }
    if (paths.has(file.path)) throw new Error('backup attachment manifest contains duplicate paths');
    paths.add(file.path);
    const sourcePath = path.resolve(sidecarRoot, ...file.path.split(/[\\/]/));
    const targetPath = path.resolve(targetRoot, ...file.path.split(/[\\/]/));
    if (!sourcePath.startsWith(`${sidecarRoot}${path.sep}`) || !targetPath.startsWith(`${targetRoot}${path.sep}`)) throw new Error('backup attachment path escapes root');
    const stat = fs.lstatSync(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('backup attachment contains an unsafe file');
    const content = fs.readFileSync(sourcePath);
    if (content.length !== file.sizeBytes || crypto.createHash('sha256').update(content).digest('hex') !== file.sha256) throw new Error('attachment digest mismatch');
    verified.push({ sourcePath, targetPath });
  }
  return verified;
}

function main(argv = process.argv, { spawnSyncImpl = spawnSync } = {}) {
  const { url, input, attachments, mysqlBin } = parseArgs(argv);
  const connection = parseMySqlUrl(url);
  if (!fs.existsSync(input)) throw new Error('backup input does not exist');
  const manifestPath = `${input}.manifest.json`;
  if (!fs.existsSync(manifestPath)) throw new Error('backup manifest is required');
  const dump = fs.readFileSync(input);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.schemaVersion !== 1 || manifest.sizeBytes !== dump.length || manifest.sha256 !== crypto.createHash('sha256').update(dump).digest('hex')) {
    throw new Error('backup manifest digest mismatch');
  }
  const verifiedAttachments = attachments ? verifyAttachmentManifest(input, attachments) : null;
  if (attachments && fs.existsSync(attachments)) throw new Error('restore attachment output already exists; choose a new directory');
  const temporaryAttachments = attachments ? `${attachments}.partial-${process.pid}-${Date.now()}` : null;
  if (temporaryAttachments && fs.existsSync(temporaryAttachments)) throw new Error('restore attachment temporary path already exists');
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
  if (verifiedAttachments) {
    try {
      fs.mkdirSync(temporaryAttachments, { recursive: true, mode: 0o700 });
      for (const { sourcePath, targetPath } of verifiedAttachments) {
        const relative = path.relative(path.resolve(attachments), targetPath);
        const temporaryTarget = path.join(temporaryAttachments, relative);
        fs.mkdirSync(path.dirname(temporaryTarget), { recursive: true, mode: 0o700 });
        fs.copyFileSync(sourcePath, temporaryTarget, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(temporaryTarget, 0o600);
      }
      fs.renameSync(temporaryAttachments, attachments);
    } catch (error) {
      try { fs.rmSync(temporaryAttachments, { recursive: true, force: true }); } catch {}
      throw error;
    }
  }
  return input;
}

if (require.main === module) {
  try { console.log(`MySQL restore completed from: ${main()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { parseArgs, verifyAttachmentManifest, main };
