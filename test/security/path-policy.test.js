const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveWithinRoot, validateFileName } = require('../../src/security/path-policy');

test('accepts a normal Chinese markdown path inside the root', () => {
  assert.equal(
    resolveWithinRoot('/srv/knowledge', 'gpu/选型指南.md', { extensions: ['.md'] }),
    path.resolve('/srv/knowledge/gpu/选型指南.md')
  );
});

for (const candidate of ['../secret', '/etc/passwd', 'gpu/../../secret', 'gpu/evil\0.md']) {
  test(`rejects unsafe path: ${JSON.stringify(candidate)}`, () => {
    assert.throws(() => resolveWithinRoot('/srv/knowledge', candidate), /unsafe path/i);
  });
}

test('rejects a sibling directory with the same string prefix', () => {
  assert.throws(
    () => resolveWithinRoot('/srv/knowledge', '../knowledge-private/file.md'),
    /unsafe path/i
  );
});

test('enforces an optional extension allowlist', () => {
  assert.throws(
    () => resolveWithinRoot('/srv/knowledge', 'gpu/选型指南.txt', { extensions: ['.md'] }),
    /unsafe path/i
  );
});

test('validateFileName accepts a normal Chinese file name unchanged', () => {
  assert.equal(validateFileName('选型指南.md'), '选型指南.md');
});

for (const name of ['folder/file.md', 'folder\\file.md', '.', '..']) {
  test(`validateFileName rejects unsafe name: ${JSON.stringify(name)}`, () => {
    assert.throws(() => validateFileName(name), /unsafe file name/i);
  });
}

test('rejects an existing intermediate symlink that escapes the root', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-policy-'));
  const root = path.join(tempDir, 'knowledge');
  const outside = path.join(tempDir, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret');
  fs.symlinkSync(outside, path.join(root, 'link'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  assert.throws(() => resolveWithinRoot(root, 'link/secret.md'), /unsafe path/i);
});
