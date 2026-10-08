'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createReleaseManifest, writeReleaseManifest, validateReleaseManifest } = require('../../src/ops/release-manifest');
const sha = 'a'.repeat(40);
const source = `'use strict'; const MYSQL_MIGRATIONS = Object.freeze([
  Object.freeze({version: 1, statements: ['CREATE TABLE example (id INT)']}),
  Object.freeze({version: 2, statements: [\`ALTER TABLE example ADD value INT\`]})
]); module.exports = { MYSQL_MIGRATIONS };`;
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-manifest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const part of ['scripts', 'dist/web', 'src/db']) fs.mkdirSync(path.join(dir, part), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  fs.writeFileSync(path.join(dir, 'scripts/start-production.js'), "throw new Error('must not execute');");
  fs.writeFileSync(path.join(dir, 'dist/web/index.html'), '<html></html>');
  fs.writeFileSync(path.join(dir, 'src/db/mysql-migrations.js'), source);
  return dir;
}
test('generates and validates release metadata without executing entrypoint', t => {
  const releaseDir = fixture(t);
  const expected = { schemaVersion: 1, gitSha: sha, appVersion: '1.2.3', mysqlSchemaVersion: 2 };
  assert.deepEqual(createReleaseManifest({ releaseDir, gitSha: sha }), expected);
  writeReleaseManifest({ releaseDir, gitSha: sha });
  assert.deepEqual(validateReleaseManifest({ releaseDir, expectedSha: sha }), expected);
  assert.throws(() => writeReleaseManifest({ releaseDir, gitSha: sha }), { code: 'RELEASE_MANIFEST_EXISTS' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(releaseDir, 'release-manifest.json'))), expected);
});
test('rejects mismatched and malformed metadata', t => {
  const releaseDir = fixture(t);
  const original = createReleaseManifest({ releaseDir, gitSha: sha });
  for (const change of [{ schemaVersion: 2 }, { gitSha: 'b'.repeat(40) }, { appVersion: '2.0.0' }, { mysqlSchemaVersion: 3 }, { extra: true }]) {
    fs.writeFileSync(path.join(releaseDir, 'release-manifest.json'), JSON.stringify({ ...original, ...change }));
    assert.throws(() => validateReleaseManifest({ releaseDir, expectedSha: sha }), { code: 'RELEASE_MANIFEST_INVALID' });
  }
  assert.throws(() => createReleaseManifest({ releaseDir, gitSha: 'main' }), { code: 'RELEASE_MANIFEST_INVALID' });
  assert.throws(() => createReleaseManifest({ releaseDir: '.', gitSha: sha }), { code: 'RELEASE_MANIFEST_INVALID' });
});
test('rejects dynamic migration source without running side effects', t => {
  const releaseDir = fixture(t);
  const canary = path.join(releaseDir, 'executed');
  for (const code of [
    source + ` require('node:fs').writeFileSync(${JSON.stringify(canary)}, 'bad');`,
    source.replace('version: 2', 'version: 1'),
    source.replace('version: 2', 'version: Math.max(2, 3)'),
    source.replace("'CREATE TABLE example (id INT)'", "String('dynamic')"),
    source.replace('ALTER TABLE example ADD value INT', 'ALTER ${process.env.SECRET}'),
  ]) {
    fs.writeFileSync(path.join(releaseDir, 'src/db/mysql-migrations.js'), code);
    assert.throws(() => createReleaseManifest({ releaseDir, gitSha: sha }), { code: 'RELEASE_MANIFEST_INVALID' });
    assert.equal(fs.existsSync(canary), false);
  }
});
for (const component of ['scripts/start-production.js', 'dist/web/index.html', 'src/db/mysql-migrations.js', 'package.json']) {
  test(`rejects missing or symlinked ${component}`, t => {
    const releaseDir = fixture(t);
    const target = path.join(releaseDir, component);
    fs.renameSync(target, target + '.original');
    assert.throws(() => createReleaseManifest({ releaseDir, gitSha: sha }), { code: 'RELEASE_MANIFEST_INVALID' });
    fs.symlinkSync(target + '.original', target);
    assert.throws(() => createReleaseManifest({ releaseDir, gitSha: sha }), { code: 'RELEASE_MANIFEST_INVALID' });
  });
}
test('rejects symlinked root and nested directory', t => {
  const releaseDir = fixture(t);
  const link = releaseDir + '-link';
  fs.symlinkSync(releaseDir, link);
  t.after(() => fs.unlinkSync(link));
  assert.throws(() => createReleaseManifest({ releaseDir: link, gitSha: sha }), { code: 'RELEASE_MANIFEST_INVALID' });
  fs.renameSync(path.join(releaseDir, 'src'), path.join(releaseDir, 'real-src'));
  fs.symlinkSync(path.join(releaseDir, 'real-src'), path.join(releaseDir, 'src'));
  assert.throws(() => createReleaseManifest({ releaseDir, gitSha: sha }), { code: 'RELEASE_MANIFEST_INVALID' });
});
test('CLI creates and checks; failure output never echoes input paths or SHA', t => {
  const releaseDir = fixture(t);
  const script = path.resolve(__dirname, '../../scripts/release-manifest.js');
  for (const mode of ['create', 'check']) {
    const result = spawnSync(process.execPath, [script, mode, releaseDir, sha], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { valid: true });
  }
  const result = spawnSync(process.execPath, [script, 'check', releaseDir, 'secret-value'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), 'RELEASE_MANIFEST_INVALID');
  assert.equal(result.stdout, '');
});

test('revalidates package and migration changes after manifest creation', t => {
  const releaseDir = fixture(t);
  writeReleaseManifest({ releaseDir, gitSha: sha });
  fs.writeFileSync(path.join(releaseDir, 'package.json'), JSON.stringify({ version: '1.2.4' }));
  assert.throws(() => validateReleaseManifest({ releaseDir, expectedSha: sha }), { code: 'RELEASE_MANIFEST_INVALID' });
  fs.writeFileSync(path.join(releaseDir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  fs.writeFileSync(path.join(releaseDir, 'src/db/mysql-migrations.js'), source.replace('version: 2', 'version: 3'));
  assert.throws(() => validateReleaseManifest({ releaseDir, expectedSha: sha }), { code: 'RELEASE_MANIFEST_INVALID' });
});

test('rejects malformed and symlinked manifest without overwriting its target', t => {
  const releaseDir = fixture(t);
  const manifest = path.join(releaseDir, 'release-manifest.json');
  for (const contents of ['{', 'null', '[]']) {
    fs.writeFileSync(manifest, contents);
    assert.throws(() => validateReleaseManifest({ releaseDir, expectedSha: sha }), { code: 'RELEASE_MANIFEST_INVALID' });
  }
  fs.unlinkSync(manifest);
  const target = path.join(releaseDir, 'canary');
  fs.writeFileSync(target, 'unchanged');
  fs.symlinkSync(target, manifest);
  assert.throws(() => validateReleaseManifest({ releaseDir, expectedSha: sha }), { code: 'RELEASE_MANIFEST_INVALID' });
  assert.throws(() => writeReleaseManifest({ releaseDir, gitSha: sha }), { code: 'RELEASE_MANIFEST_EXISTS' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
});

test('accepts the actual repository migration declaration without importing it', t => {
  const releaseDir = fixture(t);
  fs.copyFileSync(path.resolve(__dirname, '../../src/db/mysql-migrations.js'), path.join(releaseDir, 'src/db/mysql-migrations.js'));
  assert.equal(createReleaseManifest({ releaseDir, gitSha: sha }).mysqlSchemaVersion, 14);
});
