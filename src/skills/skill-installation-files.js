'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveWithinRoot, secureWorkspaceTree } = require('../security/path-policy');
const { normalizeSkillFiles, skillPackageDigest } = require('./skill-package');

function packageError() {
  const error = new Error('skill package is invalid');
  error.code = 'SKILL_INSTALLATION_PACKAGE_INVALID';
  return error;
}

function safeSegment(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw packageError();
  return value;
}

function safeSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw packageError();
  return value;
}

function packageFiles(directory) {
  const files = [];
  const stack = [{ directory, prefix: '' }];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current.directory, { withFileTypes: true })) {
      if (entry.name === '.workbench-install.json') continue;
      const relative = current.prefix ? `${current.prefix}/${entry.name}` : entry.name;
      const target = path.join(current.directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw packageError();
      if (stat.isDirectory()) {
        stack.push({ directory: target, prefix: relative });
      } else if (stat.isFile() && stat.nlink === 1) {
        files.push({ path: relative, content: fs.readFileSync(target, 'utf8') });
      } else {
        throw packageError();
      }
    }
  }
  return files;
}

function buildPackage({ userId, skill }) {
  const normalizedUserId = safeSegment(userId);
  if (!skill || typeof skill !== 'object') throw packageError();
  const skillId = safeSegment(skill.id);
  const slug = safeSlug(skill.slug);
  const versionId = safeSegment(skill.version?.id);
  const skillMd = skill.version?.skillMd;
  let files;
  try { files = normalizeSkillFiles(skill.files || [], skillMd); } catch { throw packageError(); }
  const contentSha256 = skillPackageDigest(skillMd, files);
  if (contentSha256 !== skill.version?.contentSha256) throw packageError();
  return { userId: normalizedUserId, skillId, versionId, slug, skillMd, files, contentSha256 };
}

function createSkillInstallationFiles({ root }) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new TypeError('skill installation root must be absolute');
  const installRoot = path.resolve(root);

  function ensureRoot() {
    fs.mkdirSync(installRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(installRoot, 0o700);
    secureWorkspaceTree(installRoot);
  }

  function directoryFor({ userId, slug }) {
    try {
      ensureRoot();
      const userDirectory = resolveWithinRoot(installRoot, safeSegment(userId));
      fs.mkdirSync(userDirectory, { recursive: true, mode: 0o700 });
      fs.chmodSync(userDirectory, 0o700);
      secureWorkspaceTree(userDirectory);
      return resolveWithinRoot(installRoot, `${safeSegment(userId)}/${safeSlug(slug)}`);
    } catch (error) {
      if (error?.code === 'SKILL_INSTALLATION_PACKAGE_INVALID') throw error;
      throw packageError();
    }
  }

  function readPackage(expected) {
    const directory = directoryFor(expected);
    let stat;
    try { stat = fs.lstatSync(directory); } catch { throw packageError(); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw packageError();
    try { secureWorkspaceTree(directory); } catch { throw packageError(); }
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(directory, '.workbench-install.json'), 'utf8')); } catch { throw packageError(); }
    if (!manifest || manifest.schemaVersion !== 1 || manifest.userId !== safeSegment(expected.userId) ||
        manifest.slug !== safeSlug(expected.slug) || !/^[a-f0-9]{64}$/.test(manifest.contentSha256 || '')) {
      throw packageError();
    }
    for (const [field, value] of [['skillId', expected.skillId], ['versionId', expected.versionId], ['contentSha256', expected.contentSha256]]) {
      if (value !== undefined && manifest[field] !== value) throw packageError();
    }
    let allFiles;
    try { allFiles = packageFiles(directory); } catch { throw packageError(); }
    const skillMd = allFiles.find((file) => file.path === 'SKILL.md')?.content;
    const extras = allFiles.filter((file) => file.path !== 'SKILL.md');
    let normalizedFiles;
    try { normalizedFiles = normalizeSkillFiles(extras, skillMd); } catch { throw packageError(); }
    if (skillPackageDigest(skillMd, normalizedFiles) !== manifest.contentSha256) throw packageError();
    return { directory, ...manifest, skillMd, files: normalizedFiles };
  }

  function writePackage(input) {
    const candidate = buildPackage(input);
    const destination = directoryFor(candidate);
    if (fs.existsSync(destination)) {
      const existing = readPackage(candidate);
      if (existing.skillId !== candidate.skillId || existing.versionId !== candidate.versionId ||
          existing.contentSha256 !== candidate.contentSha256) throw packageError();
      return destination;
    }
    const parent = path.dirname(destination);
    let temporary;
    try {
      temporary = fs.mkdtempSync(path.join(parent, '.install-'));
      fs.chmodSync(temporary, 0o700);
      fs.writeFileSync(path.join(temporary, 'SKILL.md'), candidate.skillMd, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      for (const file of candidate.files) {
        const target = resolveWithinRoot(temporary, file.path);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, file.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      }
      fs.writeFileSync(path.join(temporary, '.workbench-install.json'), JSON.stringify({
        schemaVersion: 1,
        userId: candidate.userId,
        skillId: candidate.skillId,
        versionId: candidate.versionId,
        slug: candidate.slug,
        contentSha256: candidate.contentSha256
      }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      secureWorkspaceTree(temporary);
      const actual = readPackageFromDirectory(temporary, candidate);
      if (actual.contentSha256 !== candidate.contentSha256) throw packageError();
      fs.renameSync(temporary, destination);
      temporary = null;
      return destination;
    } catch (error) {
      if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
      if (error?.code === 'SKILL_INSTALLATION_PACKAGE_INVALID') throw error;
      throw packageError();
    }
  }

  function replacePackage({ userId, skill, previous }) {
    const candidate = buildPackage({ userId, skill });
    const expectedPrevious = buildPackage({ userId, skill: previous });
    if (candidate.slug !== expectedPrevious.slug) throw packageError();
    const destination = directoryFor(candidate);
    if (!fs.existsSync(destination)) return writePackage({ userId, skill });
    readPackage(expectedPrevious);
    const parent = path.dirname(destination);
    let temporary;
    let backup;
    try {
      temporary = fs.mkdtempSync(path.join(parent, '.replace-'));
      fs.chmodSync(temporary, 0o700);
      fs.writeFileSync(path.join(temporary, 'SKILL.md'), candidate.skillMd, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      for (const file of candidate.files) {
        const target = resolveWithinRoot(temporary, file.path);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, file.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      }
      fs.writeFileSync(path.join(temporary, '.workbench-install.json'), JSON.stringify({
        schemaVersion: 1, userId: candidate.userId, skillId: candidate.skillId,
        versionId: candidate.versionId, slug: candidate.slug, contentSha256: candidate.contentSha256
      }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      secureWorkspaceTree(temporary);
      readPackageFromDirectory(temporary, candidate);
      backup = path.join(parent, `.replace-prev-${Date.now()}-${process.pid}`);
      fs.renameSync(destination, backup);
      fs.renameSync(temporary, destination);
      temporary = null;
      try { fs.rmSync(backup, { recursive: true, force: true }); } catch {}
      backup = null;
      return destination;
    } catch (error) {
      if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
      if (backup && !fs.existsSync(destination) && fs.existsSync(backup)) fs.renameSync(backup, destination);
      if (error?.code === 'SKILL_INSTALLATION_PACKAGE_INVALID') throw error;
      throw packageError();
    }
  }

  function hasPackage({ userId, slug }) {
    const directory = directoryFor({ userId, slug });
    try {
      const stat = fs.lstatSync(directory);
      return stat.isDirectory() && !stat.isSymbolicLink();
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw packageError();
    }
  }

  function removePackage({ userId, slug }) {
    const directory = directoryFor({ userId, slug });
    let stat;
    try { stat = fs.lstatSync(directory); } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw packageError();
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw packageError();
    fs.rmSync(directory, { recursive: true, force: false });
    return true;
  }

  function readPackageFromDirectory(directory, expected) {
    const expectedDirectory = directoryFor(expected);
    // A temporary package lives under the same protected user directory. Validate it without
    // requiring it to have the final slug path.
    if (!directory.startsWith(`${path.dirname(expectedDirectory)}${path.sep}`)) throw packageError();
    try { secureWorkspaceTree(directory); } catch { throw packageError(); }
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, '.workbench-install.json'), 'utf8'));
    if (manifest.userId !== expected.userId || manifest.skillId !== expected.skillId ||
        manifest.versionId !== expected.versionId || manifest.slug !== expected.slug) throw packageError();
    const allFiles = packageFiles(directory);
    const skillMd = allFiles.find((file) => file.path === 'SKILL.md')?.content;
    const extras = normalizeSkillFiles(allFiles.filter((file) => file.path !== 'SKILL.md'), skillMd);
    if (skillPackageDigest(skillMd, extras) !== manifest.contentSha256) throw packageError();
    return { ...manifest, skillMd, files: extras };
  }

  return { directoryFor, hasPackage, readPackage, removePackage, replacePackage, writePackage };
}

module.exports = { createSkillInstallationFiles };
