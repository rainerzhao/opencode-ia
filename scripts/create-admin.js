#!/usr/bin/env node

'use strict';

const path = require('node:path');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db/open-database');
const { migrateDatabase } = require('../src/db/migrate');
const { bootstrapAdmin } = require('../src/bootstrap/bootstrap-admin');

function cliError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--password' || arg.startsWith('--password=')) {
      throw cliError('PASSWORD_ARGUMENT_FORBIDDEN', '不接受密码参数，请通过交互提示输入密码。');
    }
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg !== '--username' && arg !== '--display-name') {
      throw cliError('INVALID_ARGUMENT', `未知参数：${arg}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw cliError('INVALID_ARGUMENT', `${arg} 缺少值`);
    }
    if (arg === '--username') options.username = value;
    else options.displayName = value;
    index += 1;
  }
  if (!options.username) throw cliError('INVALID_ARGUMENT', '必须提供 --username');
  if (!options.displayName) throw cliError('INVALID_ARGUMENT', '必须提供 --display-name');
  return options;
}

function readHiddenLine(prompt) {
  return new Promise((resolve, reject) => {
    let value = '';
    const input = process.stdin;
    process.stdout.write(prompt);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();

    function cleanup() {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
    }

    function finish() {
      cleanup();
      process.stdout.write('\n');
      resolve(value);
    }

    function onData(chunk) {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(cliError('INTERRUPTED', '操作已取消。'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
          continue;
        }
        if (character >= ' ') value += character;
      }
    }

    input.on('data', onData);
  });
}

async function readPasswords() {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    const password = await readHiddenLine('请输入密码：');
    const confirmation = await readHiddenLine('请再次输入密码：');
    return { password, confirmation };
  }

  let content = '';
  for await (const chunk of process.stdin) content += chunk.toString();
  const [password = '', confirmation = ''] = content.replace(/\r/g, '').split('\n');
  return { password, confirmation };
}

function printHelp() {
  process.stdout.write(
    '用法：npm run admin:create -- --username <用户名> --display-name <显示名>\n' +
    '密码不会通过命令参数读取，运行后请按提示输入两次。\n'
  );
}

async function main() {
  let db;
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    const { password, confirmation } = await readPasswords();
    if (password !== confirmation) {
      throw cliError('PASSWORD_MISMATCH', '两次输入的密码不一致。');
    }

    const projectDir = path.resolve(__dirname, '..');
    const config = loadConfig({ env: process.env, projectDir });
    db = openDatabase({ filename: config.databasePath });
    migrateDatabase(db);
    const admin = await bootstrapAdmin({
      db,
      username: options.username,
      displayName: options.displayName,
      password
    });
    process.stdout.write(`管理员创建成功：${admin.username}\n`);
  } catch (error) {
    const safeMessages = {
      PASSWORD_ARGUMENT_FORBIDDEN: error.message,
      INVALID_ARGUMENT: error.message,
      PASSWORD_MISMATCH: error.message,
      PASSWORD_POLICY: '密码必须包含 12–128 个字符。',
      INVALID_USERNAME: '用户名必须为 3–32 位小写字母、数字、点、下划线或连字符，并以字母开头。',
      INVALID_DISPLAY_NAME: '显示名必须包含 1–80 个字符。',
      BOOTSTRAP_ALREADY_COMPLETE: '系统已经存在账号，不能再次执行首位管理员初始化。',
      DATABASE_MIGRATION_FAILED: '数据库迁移失败，未创建管理员。',
      INTERRUPTED: error.message
    };
    process.stderr.write(`${safeMessages[error.code] || '管理员创建失败。'}\n`);
    process.exitCode = error.code === 'INVALID_ARGUMENT' || error.code === 'PASSWORD_ARGUMENT_FORBIDDEN' ? 2 : 1;
  } finally {
    db?.close();
  }
}

if (require.main === module) void main();

module.exports = { main, parseArgs, readPasswords };
