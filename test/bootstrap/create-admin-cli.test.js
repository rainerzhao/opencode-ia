'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { openDatabase } = require('../../src/db/open-database');
const { migrateDatabase } = require('../../src/db/migrate');
const { createUserStore } = require('../../src/users/user-store');

const projectDir = path.resolve(__dirname, '../..');
const script = path.join(projectDir, 'scripts/create-admin.js');

function runCli({ args, env, input = '' }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: projectDir,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('creates the first administrator from stdin without printing the password', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-admin-cli-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, 'data', 'workbench.db');
  const password = 'CLI Bootstrap 2026!';
  const result = await runCli({
    args: ['--username', 'Admin.User', '--display-name', '首位管理员'],
    env: { WORKBENCH_ROOT: root, DATABASE_PATH: databasePath },
    input: `${password}\n${password}\n`
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /管理员创建成功：admin\.user/);
  assert.equal(result.stdout.includes(password), false);
  assert.equal(result.stderr.includes(password), false);

  const db = openDatabase({ filename: databasePath });
  migrateDatabase(db);
  t.after(() => db.close());
  const users = createUserStore(db).listUsers();
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'admin');
});

test('rejects password arguments and mismatched password confirmation', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-admin-cli-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { WORKBENCH_ROOT: root, DATABASE_PATH: path.join(root, 'workbench.db') };

  const argumentResult = await runCli({
    args: ['--username', 'admin', '--display-name', 'Admin', '--password', 'Visible Password 2026!'],
    env
  });
  assert.equal(argumentResult.code, 2);
  assert.match(argumentResult.stderr, /不接受密码参数/);

  const mismatchResult = await runCli({
    args: ['--username', 'admin', '--display-name', 'Admin'],
    env,
    input: 'First Password 2026!\nSecond Password 2026!\n'
  });
  assert.equal(mismatchResult.code, 1);
  assert.match(mismatchResult.stderr, /两次输入的密码不一致/);
});
