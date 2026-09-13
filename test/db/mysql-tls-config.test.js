'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { parseMySqlUrl } = require('../../src/db/mysql-database');

test('mysqls enables both certificate chain and hostname verification', () => {
  const { ssl } = parseMySqlUrl('mysqls://user:secret@db.intra.example/workbench');
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.verifyIdentity, true);
});

test('MySQL accepts a valid CA bundle and refuses missing, malformed or ignored CA configuration', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-ca-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sslCaFile = path.join(root, 'ca.pem');
  const ca = tls.rootCertificates.slice(0, 2).join('\n');
  fs.writeFileSync(sslCaFile, ca);
  assert.equal(parseMySqlUrl('mysqls://user:secret@db.intra.example/workbench', { sslCaFile }).ssl.ca, ca);
  assert.throws(() => parseMySqlUrl('mysql://user:secret@db.intra.example/workbench', { sslCaFile }), /mysqls/);
  assert.throws(() => parseMySqlUrl('mysqls://user:secret@db.intra.example/workbench', { sslCaFile: path.join(root, 'absent') }), /CA/);
  fs.writeFileSync(sslCaFile, 'not a certificate');
  assert.throws(() => parseMySqlUrl('mysqls://user:secret@db.intra.example/workbench', { sslCaFile }), /CA/);
});

test('TLS rejects IP endpoints and unsupported URL options rather than weakening hostname validation', () => {
  assert.throws(() => parseMySqlUrl('mysqls://user:secret@127.0.0.1/workbench'), /DNS/);
  assert.throws(() => parseMySqlUrl('mysqls://user:secret@db.intra.example/workbench?ssl=false'), /options/);
});
