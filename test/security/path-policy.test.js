const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  resolveWithinRoot,
  secureWorkspaceTree,
  validateFileName
} = require('../../src/security/path-policy');

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

test('rejects Windows-style traversal on macOS and Linux', () => {
  assert.throws(
    () => resolveWithinRoot('/srv/knowledge', '..\\secret.md'),
    /unsafe path/i
  );
  assert.throws(
    () => resolveWithinRoot('/srv/knowledge', 'gpu\\..\\..\\secret.md'),
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

test('validateFileName rejects control characters', () => {
  assert.throws(() => validateFileName('guide\n.md'), /unsafe file name/i);
  assert.throws(() => validateFileName('guide\u007f.md'), /unsafe file name/i);
});

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

test('hardens workspace directories and regular artifacts while rejecting links', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-tree-'));
  const workspace = path.join(tempDir, 'workspace');
  const nested = path.join(workspace, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  const artifact = path.join(nested, 'artifact.txt');
  fs.writeFileSync(artifact, 'private artifact', { mode: 0o666 });
  fs.chmodSync(workspace, 0o777);
  fs.chmodSync(nested, 0o777);
  fs.chmodSync(artifact, 0o666);
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  secureWorkspaceTree(workspace);

  assert.equal(fs.statSync(workspace).mode & 0o777, 0o700);
  assert.equal(fs.statSync(nested).mode & 0o777, 0o700);
  assert.equal(fs.statSync(artifact).mode & 0o777, 0o600);
  fs.symlinkSync(artifact, path.join(workspace, 'linked.txt'));
  assert.throws(() => secureWorkspaceTree(workspace), /unsafe path/i);
});

test('rejects a hard-linked artifact that can alias data outside the workspace', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-hardlink-'));
  const workspace = path.join(tempDir, 'workspace');
  const outside = path.join(tempDir, 'outside.txt');
  fs.mkdirSync(workspace);
  fs.writeFileSync(outside, 'outside');
  fs.linkSync(outside, path.join(workspace, 'alias.txt'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  assert.throws(() => secureWorkspaceTree(workspace), /unsafe path/i);
});
