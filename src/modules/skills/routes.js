'use strict';

const express = require('express');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next))
    .catch((error) => next(mapStoreError(error)));
}

function routeError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function skillId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw routeError('INVALID_SKILL_ID', 'skill id is invalid', 400);
  }
  return value;
}

function mapStoreError(error) {
  const statuses = {
    INVALID_SKILL_ACTOR: 400,
    INVALID_SKILL_ID: 400,
    INVALID_SKILL_SLUG: 400,
    INVALID_SKILL_DISPLAY_NAME: 400,
    INVALID_SKILL_DESCRIPTION: 400,
    INVALID_SKILL_SOURCE: 400,
    INVALID_SKILL_STATUS: 400,
    INVALID_SKILL_PAGE: 400,
    INVALID_SKILL_UPDATE: 400,
    INVALID_SKILL_FILES: 400,
    INVALID_SKILL_VALIDATION_REPORT: 400,
    SKILL_SLUG_IMMUTABLE: 400,
    SKILL_NOT_FOUND: 404,
    SKILL_OWNER_NOT_FOUND: 404,
    SKILL_SLUG_CONFLICT: 409,
    SKILL_NOT_EDITABLE: 409,
    INVALID_SKILL_VERSION: 400,
    INVALID_SKILL_VERSION_OPERATION: 400,
    SKILL_VALIDATION_STALE: 409,
    SKILL_NOT_ARCHIVABLE: 409,
    SKILL_NOT_DISABLEABLE: 409,
    SKILL_VERSION_NOT_CREATABLE: 409,
    SKILL_VERSION_DRAFT_EXISTS: 409,
    SKILL_VERSION_NOT_SELECTABLE: 409,
    SKILL_NOT_PUBLISHABLE: 409,
    SKILL_NOT_INSTALLABLE: 409,
    SKILL_INSTALL_VERSION_CONFLICT: 409,
    SKILL_INSTALLATION_NOT_FOUND: 404,
    INVALID_SKILL_INSTALLATION_STATUS: 400,
    SKILL_ENABLE_VALIDATION_FAILED: 409,
    SKILL_VERSION_CHANGE_UNAVAILABLE: 409,
    SKILL_INSTALLATION_PACKAGE_INVALID: 409,
    SKILL_WORKSPACE_SYNC_FAILED: 409
  };
  if (statuses[error.code]) error.status = statuses[error.code];
  return error;
}

function createSkillRouter({ store, requestAuditor, validationService, installationService }) {
  if (!store || !requestAuditor || !validationService || !installationService) {
    throw new TypeError('skill route dependencies are required');
  }
  const router = express.Router();

  router.get('/installations', asyncRoute(async (req, res) => {
    res.json({ installations: await store.listInstallations({ actor: req.auth.user }) });
  }));

  router.get('/', asyncRoute(async (req, res) => {
    res.json({ skills: await store.listVisible({ actor: req.auth.user, status: req.query.status || 'draft' }) });
  }));

  router.post('/', asyncRoute(async (req, res) => {
      const skill = await store.createDraft({
        actor: req.auth.user,
        slug: req.body?.slug,
        displayName: req.body?.displayName,
        description: req.body?.description,
        skillMd: req.body?.skillMd
      });
      requestAuditor.record(req, {
        action: 'skill.create',
        targetType: 'skill',
        targetId: skill.id,
        metadata: { status: skill.status, visibility: skill.visibility, version: skill.version.version }
      });
      res.status(201).json({ skill });
  }));

  router.get('/:skillId/versions', asyncRoute(async (req, res) => {
    res.json({ versions: await store.listReleaseVersions({ actor: req.auth.user, id: skillId(req.params.skillId) }) });
  }));

  router.post('/:skillId/versions', asyncRoute(async (req, res) => {
      const skill = await store.createSuccessorDraft({ actor: req.auth.user, id: skillId(req.params.skillId) });
      requestAuditor.record(req, {
        action: 'skill.version.create', targetType: 'skill', targetId: skill.id,
        metadata: { versionId: skill.version.id, version: skill.version.version, status: skill.version.status }
      });
      res.status(201).json({ skill });
  }));

  router.get('/:skillId', asyncRoute(async (req, res) => {
      const skill = await store.getVisible({
        actor: req.auth.user,
        id: skillId(req.params.skillId)
      });
      if (!skill) throw routeError('SKILL_NOT_FOUND', 'skill was not found', 404);
      res.json({ skill });
  }));

  router.patch('/:skillId', asyncRoute(async (req, res) => {
      if (req.body && Object.hasOwn(req.body, 'slug')) {
        throw routeError('SKILL_SLUG_IMMUTABLE', 'skill slug cannot be changed', 400);
      }
      const skill = await store.updateDraft({
        actor: req.auth.user,
        id: skillId(req.params.skillId),
        displayName: req.body?.displayName,
        description: req.body?.description,
        skillMd: req.body?.skillMd
      });
      requestAuditor.record(req, {
        action: 'skill.update',
        targetType: 'skill',
        targetId: skill.id,
        metadata: { status: skill.status, version: skill.version.version }
      });
      res.json({ skill });
  }));

  router.put('/:skillId/files', asyncRoute(async (req, res) => {
      const skill = await store.replaceDraftFiles({
        actor: req.auth.user,
        id: skillId(req.params.skillId),
        files: req.body?.files
      });
      requestAuditor.record(req, {
        action: 'skill.files.replace',
        targetType: 'skill',
        targetId: skill.id,
        metadata: {
          version: skill.version.version,
          fileCount: skill.files.length,
          totalBytes: skill.files.reduce((sum, file) => sum + file.sizeBytes, 0)
        }
      });
      res.json({ skill });
  }));

  router.post('/:skillId/validate', asyncRoute(async (req, res) => {
    const skill = await validationService.validate({
      actor: req.auth.user,
      id: skillId(req.params.skillId)
    });
    const report = skill.version.validationReport;
    requestAuditor.record(req, {
      action: 'skill.validate',
      targetType: 'skill',
      targetId: skill.id,
      metadata: {
        version: skill.version.version,
        verdict: report.verdict,
        errors: report.summary.errors,
        warnings: report.summary.warnings,
        failedRules: report.checks
          .filter((item) => item.status === 'fail')
          .map((item) => item.id),
        runtimeStatus: report.runtime.status
      }
    });
    res.json({ skill });
  }));

  router.post('/:skillId/publish', asyncRoute(async (req, res) => {
      const skill = await store.publishValidated({ actor: req.auth.user, id: skillId(req.params.skillId) });
      requestAuditor.record(req, {
        action: 'skill.publish', targetType: 'skill', targetId: skill.id,
        metadata: { version: skill.version.version, status: skill.status, digest: skill.version.contentSha256 }
      });
      res.json({ skill });
  }));

  router.post('/:skillId/install', asyncRoute(async (req, res) => {
    const installation = await installationService.install({ actor: req.auth.user, id: skillId(req.params.skillId) });
    requestAuditor.record(req, {
      action: 'skill.install', targetType: 'skill', targetId: installation.skillId,
      metadata: { versionId: installation.versionId, status: installation.status, digest: installation.contentSha256 }
    });
    res.json({ installation });
  }));

  router.post('/:skillId/enable', asyncRoute(async (req, res) => {
    const installation = await installationService.enable({ actor: req.auth.user, id: skillId(req.params.skillId) });
    requestAuditor.record(req, {
      action: 'skill.enable', targetType: 'skill', targetId: installation.skillId,
      metadata: { versionId: installation.versionId, status: installation.status, digest: installation.contentSha256 }
    });
    res.json({ installation });
  }));

  for (const operation of ['upgrade', 'rollback']) {
    router.post(`/:skillId/${operation}`, asyncRoute(async (req, res) => {
        const installation = await installationService[operation]({
          actor: req.auth.user, id: skillId(req.params.skillId), versionId: req.body?.versionId
        });
        requestAuditor.record(req, {
          action: `skill.${operation}`, targetType: 'skill', targetId: installation.skillId,
          metadata: { versionId: installation.versionId, status: installation.status, digest: installation.contentSha256 }
        });
        res.json({ installation });
    }));
  }

  router.post('/:skillId/disable', asyncRoute(async (req, res) => {
      const skill = await store.disableTeamSkill({ actor: req.auth.user, id: skillId(req.params.skillId) });
      requestAuditor.record(req, {
        action: 'skill.disable', targetType: 'skill', targetId: skill.id,
        metadata: { status: skill.status }
      });
      res.json({ skill });
  }));

  router.post('/:skillId/archive', asyncRoute(async (req, res) => {
      const skill = await store.archiveTeamSkill({ actor: req.auth.user, id: skillId(req.params.skillId) });
      requestAuditor.record(req, {
        action: 'skill.archive', targetType: 'skill', targetId: skill.id,
        metadata: { status: skill.status }
      });
      res.json({ skill });
  }));

  router.delete('/:skillId', asyncRoute(async (req, res) => {
      const skill = await store.archiveDraft({
        actor: req.auth.user,
        id: skillId(req.params.skillId)
      });
      requestAuditor.record(req, {
        action: 'skill.archive',
        targetType: 'skill',
        targetId: skill.id,
        metadata: { status: skill.status }
      });
      res.status(204).end();
  }));

  return router;
}

module.exports = { createSkillRouter };
