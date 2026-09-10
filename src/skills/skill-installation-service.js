'use strict';

function installationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createSkillInstallationService({ store, installationFiles, runtimeValidator }) {
  if (!store || typeof store.getPublishedInstallCandidate !== 'function' ||
      typeof store.recordInstallation !== 'function' || typeof store.listInstallations !== 'function' ||
      typeof store.setInstallationStatus !== 'function') {
    throw new TypeError('skill installation store is required');
  }
  if (!installationFiles || typeof installationFiles.writePackage !== 'function' ||
      typeof installationFiles.readPackage !== 'function' || typeof installationFiles.hasPackage !== 'function' ||
      typeof installationFiles.removePackage !== 'function') {
    throw new TypeError('skill installation files are required');
  }
  if (!runtimeValidator || typeof runtimeValidator.validate !== 'function') {
    throw new TypeError('skill installation runtime validator is required');
  }

  function install({ actor, id }) {
    const candidate = store.getPublishedInstallCandidate({ actor, id });
    const packageRef = { userId: actor?.id, slug: candidate.slug };
    const alreadyOnDisk = installationFiles.hasPackage(packageRef);
    installationFiles.writePackage({ userId: actor?.id, skill: candidate });
    try {
      return store.recordInstallation({
        actor,
        skillId: candidate.id,
        versionId: candidate.version.id
      });
    } catch (error) {
      if (!alreadyOnDisk) installationFiles.removePackage(packageRef);
      throw error;
    }
  }

  async function enable({ actor, id }) {
    const installation = store.listInstallations({ actor }).find((item) => item.skillId === id);
    if (!installation) {
      throw installationError('SKILL_INSTALLATION_NOT_FOUND', 'skill installation was not found');
    }
    const candidate = store.getPublishedInstallCandidate({ actor, id });
    if (candidate.version.id !== installation.versionId ||
        candidate.version.contentSha256 !== installation.contentSha256) {
      throw installationError('SKILL_NOT_INSTALLABLE', 'installed skill version is no longer current');
    }
    const installed = installationFiles.readPackage({
      userId: actor?.id,
      slug: installation.slug,
      skillId: installation.skillId,
      versionId: installation.versionId,
      contentSha256: installation.contentSha256
    });
    let result;
    try {
      result = await runtimeValidator.validate({
        skillId: installation.skillId,
        versionId: installation.versionId,
        ownerUserId: actor?.id,
        slug: installation.slug,
        skillMd: installed.skillMd,
        files: installed.files,
        contentSha256: installed.contentSha256
      });
    } catch (error) {
      throw installationError('SKILL_ENABLE_VALIDATION_FAILED', 'OpenCode could not validate the installed Skill');
    }
    if (result?.status !== 'passed') {
      throw installationError('SKILL_ENABLE_VALIDATION_FAILED', 'OpenCode could not validate the installed Skill');
    }
    return store.setInstallationStatus({ actor, skillId: installation.skillId, status: 'enabled' });
  }

  return { enable, install };
}

module.exports = { createSkillInstallationService };
