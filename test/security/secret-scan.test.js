const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../../scripts/scan-secrets.js');

function runScan(root) {
  return spawnSync(process.execPath, [script, '--root', root], {
    encoding: 'utf8'
  });
}

test('accepts placeholders and ignored operator-only files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-secret-clean-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, '.env.example'), 'MODEL_API_KEY=replace-me\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'apiKey = process.env.MODEL_API_KEY\n');
  fs.writeFileSync(path.join(root, 'PROJECT_HANDOFF.md'), ['sk', 'ignored-operator-only-value'].join('-'));

  const result = runScan(root);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /Secret scan passed/);
});

test('reports relative paths and rule names without printing secret values', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-secret-unsafe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'));

  const token = ['sk', 'abcdefghijklmnop1234'].join('-');
  const assignment = ['api', 'Key = "live-value-123456"'].join('');
  const pem = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  fs.writeFileSync(path.join(root, 'config', 'token.txt'), `${token}\n${assignment}\n${pem}\n`);

  const result = runScan(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /config\/token\.txt \[OPENAI_STYLE_TOKEN\]/);
  assert.match(result.stdout, /config\/token\.txt \[API_KEY_LITERAL\]/);
  assert.match(result.stdout, /config\/token\.txt \[PEM_PRIVATE_KEY\]/);
  assert.doesNotMatch(result.stdout, new RegExp(token));
  assert.doesNotMatch(result.stdout, /live-value-123456/);
  assert.doesNotMatch(result.stdout, /BEGIN PRIVATE KEY/);
});

test('the current project is clean', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const result = runScan(projectRoot);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
