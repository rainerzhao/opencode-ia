'use strict';

function installationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function thenIfNeeded(value, next) {
  return value && typeof value.then === 'function' ? value.then(next) : next(value);
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
    return thenIfNeeded(store.getPublishedInstallCandidate({ actor, id }), (candidate) => {
      const packageRef = { userId: actor?.id, slug: candidate.slug };
      const alreadyOnDisk = installationFiles.hasPackage(packageRef);
      installationFiles.writePackage({ userId: actor?.id, skill: candidate });
      try {
        const recorded = store.recordInstallation({ actor, skillId: candidate.id, versionId: candidate.version.id });
        if (recorded && typeof recorded.then === 'function') {
          return recorded.catch((error) => {
            if (!alreadyOnDisk) installationFiles.removePackage(packageRef);
            throw error;
          });
        }
        return recorded;
      } catch (error) {
        if (!alreadyOnDisk) installationFiles.removePackage(packageRef);
        throw error;
      }
    });
  }

  async function enable({ actor, id }) {
    const installation = (await store.listInstallations({ actor })).find((item) => item.skillId === id);
    if (!installation) {
      throw installationError('SKILL_INSTALLATION_NOT_FOUND', 'skill installation was not found');
    }
    let candidate;
    try {
      candidate = typeof store.getInstalledEnableCandidate === 'function'
        ? await store.getInstalledEnableCandidate({ actor, id, versionId: installation.versionId })
        : await store.getPublishedInstallCandidate({ actor, id });
    } catch {
      throw installationError('SKILL_NOT_INSTALLABLE', 'installed skill version is no longer available');
    }
    if (candidate.version.id !== installation.versionId || candidate.version.contentSha256 !== installation.contentSha256) {
      throw installationError('SKILL_NOT_INSTALLABLE', 'installed skill version is no longer available');
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
    return await store.setInstallationStatus({ actor, skillId: installation.skillId, status: 'enabled' });
  }

  function changeVersion({ actor, id, versionId, operation }) {
    if (!['upgrade', 'rollback'].includes(operation) ||
        typeof store.getVersionChangeCandidate !== 'function' ||
        typeof store.selectInstallationVersion !== 'function' ||
        typeof store.getInstalledEnableCandidate !== 'function' ||
        typeof installationFiles.replacePackage !== 'function') {
      throw installationError('SKILL_VERSION_CHANGE_UNAVAILABLE', 'skill version change is unavailable');
    }
    return thenIfNeeded(store.listInstallations({ actor }), (installations) => {
      const installation = installations.find((item) => item.skillId === id);
      if (!installation) throw installationError('SKILL_INSTALLATION_NOT_FOUND', 'skill installation was not found');
      return thenIfNeeded(store.getVersionChangeCandidate({ actor, id, versionId, operation }), (target) => {
        if (target.version.id === installation.versionId) return installation;
        return thenIfNeeded(store.getInstalledEnableCandidate({ actor, id, versionId: installation.versionId }), (previous) => {
          installationFiles.replacePackage({ userId: actor?.id, skill: target, previous });
          try {
            const changed = store.selectInstallationVersion({ actor, skillId: id, versionId: target.version.id, operation });
            if (changed && typeof changed.then === 'function') return changed.catch((error) => {
              try { installationFiles.replacePackage({ userId: actor?.id, skill: previous, previous: target }); } catch {}
              throw error;
            });
            return changed;
          } catch (error) {
            try { installationFiles.replacePackage({ userId: actor?.id, skill: previous, previous: target }); } catch {}
            throw error;
          }
        });
      });
    });
  }

  function upgrade({ actor, id, versionId }) {
    return changeVersion({ actor, id, versionId, operation: 'upgrade' });
  }

  function rollback({ actor, id, versionId }) {
    return changeVersion({ actor, id, versionId, operation: 'rollback' });
  }

  return { enable, install, rollback, upgrade };
}

module.exports = { createSkillInstallationService };
