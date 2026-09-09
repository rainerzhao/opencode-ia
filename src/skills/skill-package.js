'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const SKILL_FILE_EXTENSIONS = new Set([
  '.cjs', '.js', '.json', '.jsonc', '.md', '.mjs', '.py', '.sh', '.ts',
  '.txt', '.yaml', '.yml'
]);
const MAX_SKILL_FILES = 64;
const MAX_SKILL_FILE_BYTES = 262144;
const MAX_SKILL_PACKAGE_BYTES = 1048576;

function packageError() {
  const error = new Error('skill files are invalid');
  error.code = 'INVALID_SKILL_FILES';
  return error;
}

function normalizeSkillFiles(value, skillMd) {
  if (!Array.isArray(value) || typeof skillMd !== 'string' || value.length > MAX_SKILL_FILES) {
    throw packageError();
  }
  const seen = new Set();
  let totalBytes = Buffer.byteLength(skillMd, 'utf8');
  const files = value.map((file) => {
    if (!file || typeof file !== 'object' || Array.isArray(file) ||
        typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw packageError();
    }
    const filePath = file.path.normalize('NFC');
    const segments = filePath.split('/');
    const pathBytes = Buffer.byteLength(filePath, 'utf8');
    const unsafePath = filePath !== file.path || filePath !== filePath.trim() ||
      filePath.startsWith('/') || filePath.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(filePath) || pathBytes > 200 ||
      segments.length > 6 ||
      segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'));
    const extension = path.posix.extname(filePath).toLowerCase();
    const duplicateKey = filePath.toLowerCase();
    if (unsafePath || !SKILL_FILE_EXTENSIONS.has(extension) ||
        path.posix.basename(filePath).toLowerCase() === 'skill.md' || seen.has(duplicateKey)) {
      throw packageError();
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(file.content)) {
      throw packageError();
    }
    const sizeBytes = Buffer.byteLength(file.content, 'utf8');
    if (sizeBytes > MAX_SKILL_FILE_BYTES) throw packageError();
    totalBytes += sizeBytes;
    if (totalBytes > MAX_SKILL_PACKAGE_BYTES) throw packageError();
    seen.add(duplicateKey);
    return { path: filePath, content: file.content, sizeBytes };
  });
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

function skillPackageDigest(skillMd, files) {
  const digest = crypto.createHash('sha256').update(skillMd);
  for (const file of files) {
    digest.update('\0').update(file.path).update('\0');
    digest.update(String(file.sizeBytes)).update('\0').update(file.content);
  }
  return digest.digest('hex');
}

module.exports = {
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_FILES,
  MAX_SKILL_PACKAGE_BYTES,
  normalizeSkillFiles,
  skillPackageDigest
};
