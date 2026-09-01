#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const SKIPPED_DIRECTORIES = new Set([
  '.git', '.worktrees', 'node_modules', 'data', 'backups', 'coverage', 'dist', 'build', 'tmp'
]);
const SKIPPED_FILES = new Set(['PROJECT_HANDOFF.md', 'server.log']);
const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.env', '.example', '.html', '.js', '.json', '.jsonc',
  '.lock', '.md', '.mjs', '.sh', '.text', '.toml', '.ts', '.txt', '.yaml', '.yml'
]);
const RULES = [
  { name: 'OPENAI_STYLE_TOKEN', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  {
    name: 'API_KEY_LITERAL',
    pattern: /\bapi[_-]?key\b\s*[:=]\s*(['"])([^'"\r\n]+)\1/gi,
    isFinding(match) {
      const value = match[2].trim().toLowerCase();
      return !['replace', 'placeholder', 'example', 'changeme', 'your-', 'process.env', '${']
        .some((marker) => value.includes(marker));
    }
  },
  { name: 'PEM_PRIVATE_KEY', pattern: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/g }
];

function parseRoot(argv) {
  const index = argv.indexOf('--root');
  if (index === -1) return process.cwd();
  if (!argv[index + 1]) throw new Error('--root requires a directory');
  return path.resolve(argv[index + 1]);
}

function shouldScanFile(name) {
  if (SKIPPED_FILES.has(name)) return false;
  if (name === '.env' || /^\.env\.(?!example$)/.test(name)) return false;
  if (name.endsWith('.log') || name.endsWith('.db') || name.includes('.db-')) return false;
  if (name === 'Dockerfile' || name === 'LICENSE') return true;
  return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function listTextFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(path.join(directory, entry.name));
      } else if (entry.isFile() && shouldScanFile(entry.name)) {
        files.push(path.join(directory, entry.name));
      }
    }
  }
  visit(root);
  return files.sort();
}

function scanFile(file) {
  if (fs.statSync(file).size > 5 * 1024 * 1024) return [];
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('\0')) return [];
  const findings = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(content)) !== null) {
      if (!rule.isFinding || rule.isFinding(match)) findings.push(rule.name);
      if (match[0].length === 0) rule.pattern.lastIndex += 1;
    }
  }
  return [...new Set(findings)];
}

function main() {
  const root = parseRoot(process.argv.slice(2));
  const findings = [];
  for (const file of listTextFiles(root)) {
    for (const rule of scanFile(file)) {
      findings.push({ file: path.relative(root, file).split(path.sep).join('/'), rule });
    }
  }
  if (findings.length) {
    console.log('Secret scan failed:');
    for (const finding of findings) console.log(`${finding.file} [${finding.rule}]`);
    process.exitCode = 1;
  } else {
    console.log('Secret scan passed: no findings.');
  }
}

try {
  main();
} catch (error) {
  console.error(`Secret scan error: ${error.message}`);
  process.exitCode = 2;
}
