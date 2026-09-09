'use strict';

const express = require('express');

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
    SKILL_SLUG_IMMUTABLE: 400,
    SKILL_NOT_FOUND: 404,
    SKILL_OWNER_NOT_FOUND: 404,
    SKILL_SLUG_CONFLICT: 409,
    SKILL_NOT_EDITABLE: 409,
    SKILL_NOT_ARCHIVABLE: 409
  };
  if (statuses[error.code]) error.status = statuses[error.code];
  return error;
}

function createSkillRouter({ store, requestAuditor }) {
  if (!store || !requestAuditor) throw new TypeError('skill route dependencies are required');
  const router = express.Router();

  router.get('/', (req, res, next) => {
    try {
      res.json({
        skills: store.listVisible({
          actor: req.auth.user,
          status: req.query.status || 'draft'
        })
      });
    } catch (error) { next(mapStoreError(error)); }
  });

  router.post('/', (req, res, next) => {
    try {
      const skill = store.createDraft({
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
    } catch (error) { next(mapStoreError(error)); }
  });

  router.get('/:skillId', (req, res, next) => {
    try {
      const skill = store.getVisible({
        actor: req.auth.user,
        id: skillId(req.params.skillId)
      });
      if (!skill) throw routeError('SKILL_NOT_FOUND', 'skill was not found', 404);
      res.json({ skill });
    } catch (error) { next(mapStoreError(error)); }
  });

  router.patch('/:skillId', (req, res, next) => {
    try {
      if (req.body && Object.hasOwn(req.body, 'slug')) {
        throw routeError('SKILL_SLUG_IMMUTABLE', 'skill slug cannot be changed', 400);
      }
      const skill = store.updateDraft({
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
    } catch (error) { next(mapStoreError(error)); }
  });

  router.delete('/:skillId', (req, res, next) => {
    try {
      const skill = store.archiveDraft({
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
    } catch (error) { next(mapStoreError(error)); }
  });

  return router;
}

module.exports = { createSkillRouter };
