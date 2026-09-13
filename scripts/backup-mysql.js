#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseMySqlUrl } = require('../src/db/mysql-database');
const { mysqlClientOptions } = require('./mysql-client-options');

function parseArgs(argv, env = process.env) {
  const values = { url: env.WORKBENCH_DATABASE_URL };
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--url', '--output', '--attachments', '--mysqldump-bin'].includes(key) || !value || value.startsWith('--')) {
      throw new Error('usage: backup-mysql.js [--url <mysql-url>] --output <path> [--attachments <dir>] [--mysqldump-bin <path>]');
    }
    values[key.slice(2)] = value;
  }
  if (!values.url || !values.output) throw new Error('MySQL URL and output are required');
  return {
    ...values,
    output: path.resolve(values.output),
    attachments: values.attachments ? path.resolve(values.attachments) : null,
    mysqldumpBin: values.mysqldumpBin || 'mysqldump'
  };
}

function copyAttachments(sourceRoot, destinationRoot) {
  const sourceStat = fs.lstatSync(sourceRoot);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('attachment root must be a directory');
  const manifest = [];
  function visit(source, relative) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('attachment backup refuses symbolic links');
      const child = path.join(source, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(child, childRelative);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(child);
        const target = path.join(destinationRoot, ...childRelative.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.copyFileSync(child, target, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(target, 0o600);
        manifest.push({
          path: childRelative,
          sizeBytes: content.length,
          sha256: crypto.createHash('sha256').update(content).digest('hex')
        });
      } else {
        throw new Error('attachment backup accepts regular files only');
      }
    }
  }
  fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  visit(sourceRoot, '');
  return manifest.sort((left, right) => left.path.localeCompare(right.path));
}

function main(argv = process.argv, { env = process.env, spawnSyncImpl = spawnSync, clock = () => new Date().toISOString() } = {}) {
  const { url, output, attachments, mysqldumpBin } = parseArgs(argv, env);
  const connection = parseMySqlUrl(url, { sslCaFile: env.MYSQL_SSL_CA_FILE });
  const sqlManifest = `${output}.manifest.json`;
  const attachmentOutput = attachments ? `${output}.attachments` : null;
  const attachmentManifest = attachments ? `${output}.attachments.manifest.json` : null;
  if ([output, sqlManifest, attachmentOutput, attachmentManifest].some((target) => target && fs.existsSync(target))) {
    throw new Error('backup output already exists');
  }
  if (attachments && (!fs.existsSync(attachments) || !fs.lstatSync(attachments).isDirectory())) {
    throw new Error('attachment root does not exist');
  }
  const temporary = `${output}.partial`;
  const temporaryAttachmentManifest = attachmentManifest ? `${attachmentManifest}.partial` : null;
  const args = [
    ...mysqlClientOptions(connection, env.MYSQL_SSL_CA_FILE),
    '--single-transaction', '--routines', '--triggers', '--no-tablespaces', '--set-gtid-purged=OFF', connection.database
  ];
  let temporaryAttachment = null;
  try {
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    temporaryAttachment = attachments ? fs.mkdtempSync(path.join(path.dirname(output), `.${path.basename(output)}.attachments-`)) : null;
    const result = spawnSyncImpl(mysqldumpBin, args, {
      env: { ...env, MYSQL_PWD: connection.password },
      encoding: null,
      maxBuffer: 512 * 1024 * 1024
    });
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
    if (attachments) {
      const manifest = copyAttachments(attachments, temporaryAttachment);
      fs.renameSync(temporaryAttachment, attachmentOutput);
      fs.writeFileSync(temporaryAttachmentManifest, JSON.stringify({ schemaVersion: 1, files: manifest }, null, 2), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporaryAttachmentManifest, attachmentManifest);
      fs.chmodSync(attachmentOutput, 0o700);
      fs.chmodSync(attachmentManifest, 0o600);
    }
    fs.chmodSync(output, 0o600);
    return output;
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    try { fs.rmSync(output, { force: true }); } catch {}
    try { fs.rmSync(sqlManifest, { force: true }); } catch {}
    if (temporaryAttachment) {
      try { fs.rmSync(temporaryAttachment, { recursive: true, force: true }); } catch {}
    }
    if (attachmentOutput) {
      try { fs.rmSync(attachmentOutput, { recursive: true, force: true }); } catch {}
    }
    if (temporaryAttachmentManifest) {
      try { fs.rmSync(temporaryAttachmentManifest, { force: true }); } catch {}
    }
    if (attachmentManifest) {
      try { fs.rmSync(attachmentManifest, { force: true }); } catch {}
    }
    throw error;
  }
}

if (require.main === module) {
  try { console.log(`MySQL backup created: ${main()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { parseArgs, copyAttachments, main };
