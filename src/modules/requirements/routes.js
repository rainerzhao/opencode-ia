'use strict';

const express = require('express');
const { normalizeRequirement, normalizeInteraction, normalizeRequirementQuery } = require('../../requirements/requirement-input');

function routeError(code, message, status = 400) { const error = new Error(message); error.code = code; error.status = status; return error; }
function requirementId(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw routeError('INVALID_REQUIREMENT_ID', 'requirement id is invalid'); return value; }
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => next(mapError(error))); }
function mapError(error) {
  const statuses = {
    REQUIREMENT_NOT_FOUND: 404, BUSINESS_UNIT_NOT_FOUND: 404, BUSINESS_UNIT_EXISTS: 409, BUSINESS_UNIT_IN_USE: 409,
    INVALID_REQUIREMENT_INPUT: 400, INVALID_REQUIREMENT_ID: 400, INVALID_REQUIREMENT_ACTOR: 400,
    INVALID_BUSINESS_UNIT: 400, INVALID_REQUIREMENT_INTERACTION: 400
  };
  if (statuses[error.code]) error.status = statuses[error.code]; return error;
}
function audit(req, auditor, action, targetType, targetId, metadata) { auditor.record(req, { action, targetType, targetId, metadata }); }

function createRequirementRouter({ store, requestAuditor, requireAdmin }) {
  if (!store || !requestAuditor || typeof requireAdmin !== 'function') throw new TypeError('requirement route dependencies are required');
  const router = express.Router();
  router.get('/business-units', asyncRoute(async (_req, res) => res.json({ businessUnits: await store.listBusinessUnits({ activeOnly: true }) })));
  router.post('/business-units', requireAdmin, asyncRoute(async (req, res) => {
    const businessUnit = await store.createBusinessUnit({ actorUserId: req.auth.user.id, actorRole: req.auth.user.role, name: req.body?.name });
    audit(req, requestAuditor, 'requirement.business_unit.create', 'business_unit', businessUnit.id, { status: businessUnit.status }); res.status(201).json({ businessUnit });
  }));
  router.delete('/business-units/:businessUnitId', requireAdmin, asyncRoute(async (req, res) => {
    const businessUnit = await store.archiveBusinessUnit({ actorUserId: req.auth.user.id, actorRole: req.auth.user.role, id: requirementId(req.params.businessUnitId) });
    audit(req, requestAuditor, 'requirement.business_unit.archive', 'business_unit', businessUnit.id, { status: businessUnit.status }); res.status(204).end();
  }));
  router.get('/', asyncRoute(async (req, res) => {
    const query = normalizeRequirementQuery(req.query || {});
    res.json(await store.listRequirements({ ownerUserId: req.auth.user.id, ...query, query: query.query }));
  }));
  router.post('/', asyncRoute(async (req, res) => {
    const input = normalizeRequirement(req.body);
    const requirement = await store.createRequirement({ ownerUserId: req.auth.user.id, ...input });
    audit(req, requestAuditor, 'requirement.create', 'requirement', requirement.id, { buId: requirement.buId, status: requirement.status }); res.status(201).json({ requirement });
  }));
  router.get('/:requirementId', asyncRoute(async (req, res) => res.json({ requirement: await store.getRequirement({ ownerUserId: req.auth.user.id, id: requirementId(req.params.requirementId) }) })));
  router.patch('/:requirementId', asyncRoute(async (req, res) => {
    const input = normalizeRequirement(req.body, { patch: true }); const requirement = await store.updateRequirement({ ownerUserId: req.auth.user.id, id: requirementId(req.params.requirementId), ...input });
    audit(req, requestAuditor, 'requirement.update', 'requirement', requirement.id, { buId: requirement.buId, status: requirement.status }); res.json({ requirement });
  }));
  router.post('/:requirementId/interactions', asyncRoute(async (req, res) => {
    const input = normalizeInteraction(req.body); const interaction = await store.addInteraction({ ownerUserId: req.auth.user.id, requirementId: requirementId(req.params.requirementId), ...input });
    audit(req, requestAuditor, 'requirement.interaction.create', 'requirement_interaction', interaction.id, { requirementId: interaction.requirementId, channel: interaction.channel }); res.status(201).json({ interaction });
  }));
  return router;
}

module.exports = { createRequirementRouter };
