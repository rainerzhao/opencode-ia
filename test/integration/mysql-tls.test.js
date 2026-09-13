'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const dns = require('node:dns');
const { randomUUID } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { main: backup } = require('../../scripts/backup-mysql');
const { main: restore } = require('../../scripts/restore-mysql');
const { runAdminCli } = require('../fixtures/admin-cli');
const { createMySqlProductionWorkbench } = require('../../apps/server');

test('real MySQL TLS verifies CA and hostname and encrypts a dump/restore round trip', {
  skip: process.env.WORKBENCH_TLS_ACCEPTANCE !== '1', timeout: 120000
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-mysql-tls-'));
  const container = `workbench-tls-test-${randomUUID()}`;
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.chmodSync(root, 0o755);
  const cert = path.join(root, 'server-cert.pem');
  const key = path.join(root, 'server-key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  // Disposable test key, readable by the mysql UID inside the isolated container only.
  fs.chmodSync(key, 0o644);
  execFileSync('docker', ['run', '-d', '--name', container, '--tmpfs', '/var/lib/mysql',
    '-p', '127.0.0.1::3306', '--mount', `type=bind,source=${root},target=/certs,readonly`,
    '-e', 'MYSQL_ROOT_PASSWORD=test-only-password', '-e', 'MYSQL_DATABASE=tls_test',
    '-e', 'MYSQL_USER=workbench_test', '-e', 'MYSQL_PASSWORD=test-only-password', 'mysql:8.4',
    '--ssl-ca=/certs/server-cert.pem', '--ssl-cert=/certs/server-cert.pem', '--ssl-key=/certs/server-key.pem',
    '--require-secure-transport=ON', '--character-set-server=utf8mb4', '--default-time-zone=+00:00', '--ngram_token_size=2'],
  { stdio: 'pipe', timeout: 20000 });
  t.after(() => execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore', timeout: 10000 }));
  const port = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', container], { encoding: 'utf8' }))['3306/tcp'][0].HostPort;
  const url = `mysqls://workbench_test:test-only-password@localhost:${port}/tls_test`;
  const db = await createMySqlDatabase({ url, sslCaFile: cert, poolSize: 2 });
  t.after(() => db.close());
  const deadline = Date.now() + 75000;
  while (true) {
    try { await db.assertCapabilities(); break; }
    catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const cipher = await db.one("SHOW STATUS LIKE 'Ssl_cipher'");
  assert.ok(cipher.Value.length > 0);
  const wrongCa = path.join(root, 'wrong-ca.pem');
  fs.writeFileSync(wrongCa, tls.rootCertificates[0]);
  const untrusted = await createMySqlDatabase({ url, sslCaFile: wrongCa });
  try { await assert.rejects(() => untrusted.query('SELECT 1'), /certificate|self.signed/i); }
  finally { await untrusted.close(); }

  const originalLookup = dns.lookup;
  const lookup = t.mock.method(dns, 'lookup', (hostname, options, callback) =>
    originalLookup(hostname === 'wrong.test.invalid' ? 'localhost' : hostname, options, callback));
  const wrongHost = await createMySqlDatabase({ url: url.replace('@localhost:', '@wrong.test.invalid:'), sslCaFile: cert });
  try { await assert.rejects(() => wrongHost.query('SELECT 1'), /hostname|altnames|certificate/i); }
  finally { await wrongHost.close(); lookup.mock.restore(); }

  const initialized = await runAdminCli({ root, url, env: { MYSQL_SSL_CA_FILE: cert } });
  assert.equal(initialized.code, 0, initialized.stderr);
  const application = await createMySqlProductionWorkbench({ projectDir: root,
    env: { WORKBENCH_ROOT: root, WORKBENCH_DATABASE_URL: url, MYSQL_SSL_CA_FILE: cert },
    logger: { log() {}, error() {} } });
  try { assert.equal((await application.database.one('SELECT username FROM users')).username, 'admin'); }
  finally { await application.stop(); }
  assert.equal(fs.existsSync(path.join(root, 'data/workbench.db')), false);

  await db.query('CREATE TABLE tls_roundtrip (id INT PRIMARY KEY, body TEXT)');
  await db.query('INSERT INTO tls_roundtrip VALUES (1, ?)', ['encrypted backup']);
  const env = { WORKBENCH_DATABASE_URL: url, MYSQL_SSL_CA_FILE: cert };
  function runClient(bin, args, options) {
    const mapped = args.map((arg, index) => args[index - 1] === '--port' ? '3306' :
      arg === `--ssl-ca=${cert}` ? '--ssl-ca=/certs/server-cert.pem' : arg);
    return spawnSync('docker', ['exec', '-i', '-e', `MYSQL_PWD=${options.env.MYSQL_PWD}`, container, bin, ...mapped],
      { input: options.input, encoding: null, timeout: 10000, maxBuffer: options.maxBuffer });
  }
  const output = path.join(root, 'backup.sql');
  backup(['node', 'backup-mysql.js', '--output', output], { env, spawnSyncImpl: runClient });
  await db.query('UPDATE tls_roundtrip SET body = ?', ['changed']);
  restore(['node', 'restore-mysql.js', '--input', output, '--confirm'], { env, spawnSyncImpl: runClient });
  assert.equal((await db.one('SELECT body FROM tls_roundtrip WHERE id = 1')).body, 'encrypted backup');
});
