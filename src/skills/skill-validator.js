'use strict';

const crypto = require('node:crypto');
const { normalizeSkillFiles, skillPackageDigest } = require('./skill-package');

function result(id, status, message, findings = []) {
  return { id, status, severity: 'error', message, findings };
}

function parseFrontmatter(skillMd) {
  const normalized = skillMd.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { valid: false, metadata: {}, body: '' };
  }
  const closing = normalized.indexOf('\n---\n', 4);
  if (closing === -1) return { valid: false, metadata: {}, body: '' };
  const metadata = {};
  for (const line of normalized.slice(4, closing).split('\n')) {
    const match = line.match(/^([a-z][a-z0-9_-]*):\s*(.*?)\s*$/i);
    if (!match || Object.hasOwn(metadata, match[1].toLowerCase())) {
      return { valid: false, metadata: {}, body: '' };
    }
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    metadata[match[1].toLowerCase()] = value.trim();
  }
  const valid = typeof metadata.name === 'string' && metadata.name.length > 0 &&
    typeof metadata.description === 'string' && metadata.description.length > 0 &&
    Array.from(metadata.description).length <= 500;
  return { valid, metadata, body: normalized.slice(closing + 5) };
}

function sourceLines(skillMd, files) {
  return [
    { path: 'SKILL.md', content: skillMd },
    ...files.map((file) => ({ path: file.path, content: file.content }))
  ];
}

function scanSources(sources, rules) {
  const findings = [];
  for (const source of sources) {
    const lines = source.content.replace(/\r\n/g, '\n').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      for (const rule of rules) {
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(lines[index])) {
          findings.push({ ruleId: rule.id, path: source.path, line: index + 1 });
        }
      }
    }
  }
  return findings;
}

function fallbackDigest(slug, skillMd, files) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ slug, skillMd, files }))
    .digest('hex');
}

function validateSkillPackage({ slug, skillMd, files = [], clock = () => new Date().toISOString() } = {}) {
  const safeSlug = typeof slug === 'string' ? slug : '';
  const safeSource = typeof skillMd === 'string' ? skillMd : '';
  let normalizedFiles = [];
  let packageValid = true;
  try {
    normalizedFiles = normalizeSkillFiles(files, safeSource);
  } catch {
    packageValid = false;
  }
  const packageCheck = result(
    'package-boundary',
    packageValid ? 'pass' : 'fail',
    packageValid ? 'package boundaries are valid' : 'skill package boundaries are invalid'
  );

  const parsed = parseFrontmatter(safeSource);
  const frontmatterCheck = result(
    'frontmatter',
    parsed.valid ? 'pass' : 'fail',
    parsed.valid ? 'frontmatter is valid' : 'frontmatter must contain unique name and description fields'
  );
  const nameValid = parsed.valid && parsed.metadata.name === safeSlug;
  const nameCheck = result(
    'metadata-name',
    nameValid ? 'pass' : 'fail',
    nameValid ? 'frontmatter name matches the Skill slug' : 'frontmatter name must match the Skill slug'
  );
  const instructionsValid = parsed.valid && parsed.body.trim().length > 0;
  const instructionsCheck = result(
    'instructions',
    instructionsValid ? 'pass' : 'fail',
    instructionsValid ? 'instruction body is present' : 'instruction body is required'
  );

  const sources = sourceLines(safeSource, normalizedFiles);
  const secretFindings = packageValid ? scanSources(sources, [
    { id: 'openai-style-token', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
    { id: 'api-key-literal', pattern: /\bapi[_-]?key\b\s*[:=]\s*['"][^'"\r\n]{12,}['"]/gi },
    { id: 'private-key', pattern: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/g }
  ]) : [];
  const secretsCheck = result(
    'secrets',
    secretFindings.length ? 'fail' : 'pass',
    secretFindings.length ? 'potential secrets detected' : 'no potential secrets detected',
    secretFindings
  );

  const commandFindings = packageValid ? scanSources(sources, [
    { id: 'download-pipe-shell', pattern: /\b(?:curl|wget)\b[^|\r\n]*\|\s*(?:ba)?sh\b/gi },
    { id: 'privilege-escalation', pattern: /(^|[;&|]\s*)sudo\b|^\s*sudo\b/gi },
    { id: 'world-writable', pattern: /\bchmod\s+(?:-R\s+)?777\b/gi },
    { id: 'destructive-delete', pattern: /\brm\s+-[^\r\n]*r[^\r\n]*f[^\r\n]*(?:\s\/|\s~|\$HOME)/gi }
  ]) : [];
  const commandsCheck = result(
    'dangerous-commands',
    commandFindings.length ? 'fail' : 'pass',
    commandFindings.length ? 'high-risk command patterns detected' : 'no high-risk command patterns detected',
    commandFindings
  );

  const checks = [
    packageCheck, frontmatterCheck, nameCheck, instructionsCheck, secretsCheck, commandsCheck
  ];
  const errors = checks.filter((item) => item.status === 'fail').length;
  const totalBytes = Buffer.byteLength(safeSource, 'utf8') + normalizedFiles
    .reduce((sum, file) => sum + file.sizeBytes, 0);
  return {
    schemaVersion: 1,
    verdict: errors ? 'fail' : 'pass',
    checkedAt: clock(),
    contentSha256: packageValid
      ? skillPackageDigest(safeSource, normalizedFiles)
      : fallbackDigest(safeSlug, safeSource, files),
    summary: {
      errors,
      warnings: 0,
      files: 1 + (Array.isArray(files) ? files.length : 0),
      totalBytes
    },
    checks,
    runtime: { status: 'not_run', provider: 'opencode-gateway' }
  };
}

module.exports = { validateSkillPackage };
