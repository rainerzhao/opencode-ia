'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveWithinRoot, secureWorkspaceTree } = require('../security/path-policy');

function syncError() {
  const error = new Error('skill package is invalid');
  error.code = 'SKILL_WORKSPACE_SYNC_FAILED';
  return error;
}

function createSkillWorkspaceSync({ installationFiles }) {
  if (!installationFiles || typeof installationFiles.readPackage !== 'function') {
    throw new TypeError('skill installation files are required');
  }

  function syncEnabledSkills({ userId, directory, installations }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || !Array.isArray(installations)) {
      throw syncError();
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { secureWorkspaceTree(directory); } catch { throw syncError(); }
    const packages = installations.map((installation) => installationFiles.readPackage({
      userId,
      slug: installation?.slug,
      skillId: installation?.skillId,
      versionId: installation?.versionId,
      contentSha256: installation?.contentSha256
    }));
    const opencodeDirectory = resolveWithinRoot(directory, '.opencode');
    fs.mkdirSync(opencodeDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(opencodeDirectory, 0o700);
    const target = resolveWithinRoot(directory, '.opencode/skills');
    let next;
    let backup;
    try {
      next = fs.mkdtempSync(path.join(opencodeDirectory, 'skills-next-'));
      fs.chmodSync(next, 0o700);
      for (const candidate of packages) {
        const skillDirectory = resolveWithinRoot(next, candidate.slug);
        fs.mkdirSync(skillDirectory, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(skillDirectory, 'SKILL.md'), candidate.skillMd, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        for (const file of candidate.files) {
          const output = resolveWithinRoot(skillDirectory, file.path);
          fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
          fs.writeFileSync(output, file.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        }
      }
      secureWorkspaceTree(next);
      if (fs.existsSync(target)) {
        backup = path.join(opencodeDirectory, `skills-prev-${Date.now()}-${process.pid}`);
        fs.renameSync(target, backup);
      }
      fs.renameSync(next, target);
      next = null;
      if (backup) fs.rmSync(backup, { recursive: true, force: true });
      secureWorkspaceTree(directory);
      return target;
    } catch (error) {
      if (next) fs.rmSync(next, { recursive: true, force: true });
      if (backup && !fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
      if (error?.code === 'SKILL_INSTALLATION_PACKAGE_INVALID') throw error;
      throw syncError();
    }
  }

  return { syncEnabledSkills };
}

module.exports = { createSkillWorkspaceSync };
