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
    INVALID_BUSINESS_UNIT: 400, INVALID_REQUIREMENT_INTERACTION: 400, INVALID_REQUIREMENT_LINK: 400,
    REQUIREMENT_LINK_TARGET_NOT_FOUND: 404, REQUIREMENT_LINK_NOT_FOUND: 404, REQUIREMENT_LINK_EXISTS: 409,
    INVALID_REQUIREMENT_FIELD_TEMPLATE: 400, INVALID_REQUIREMENT_FIELD_VALUE: 400, INVALID_REQUIREMENT_FIELD_VALUES: 400,
    REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND: 404, REQUIREMENT_FIELD_TEMPLATE_EXISTS: 409, REQUIRED_REQUIREMENT_FIELD_VALUE: 400,
    REQUIREMENT_DRAFT_NOT_FOUND: 404, REQUIREMENT_DRAFT_SOURCE_NOT_FOUND: 404, REQUIREMENT_DRAFT_NOT_READY: 409,
    INVALID_REQUIREMENT_DRAFT: 400, INVALID_REQUIREMENT_DRAFT_REQUEST: 400, INVALID_REQUIREMENT_DRAFT_OUTPUT: 422
  };
  if (statuses[error.code]) error.status = statuses[error.code]; return error;
}
function audit(req, auditor, action, targetType, targetId, metadata) { auditor.record(req, { action, targetType, targetId, metadata }); }

function createRequirementRouter({ store, requestAuditor, requireAdmin, draftService = null }) {
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
  router.get('/field-templates', asyncRoute(async (_req, res) => res.json({ fieldTemplates: await store.listFieldTemplates({ activeOnly: true }) })));
  router.post('/field-templates', requireAdmin, asyncRoute(async (req, res) => {
    const fieldTemplate = await store.createFieldTemplate({ actorUserId: req.auth.user.id, actorRole: req.auth.user.role, ...req.body });
    audit(req, requestAuditor, 'requirement.field_template.create', 'requirement_field_template', fieldTemplate.id, { key: fieldTemplate.key, type: fieldTemplate.type, schemaVersion: fieldTemplate.schemaVersion }); res.status(201).json({ fieldTemplate });
  }));
  router.patch('/field-templates/:templateId', requireAdmin, asyncRoute(async (req, res) => {
    const fieldTemplate = await store.updateFieldTemplate({ actorUserId: req.auth.user.id, actorRole: req.auth.user.role, id: requirementId(req.params.templateId), ...req.body });
    audit(req, requestAuditor, 'requirement.field_template.update', 'requirement_field_template', fieldTemplate.id, { key: fieldTemplate.key, type: fieldTemplate.type, schemaVersion: fieldTemplate.schemaVersion }); res.json({ fieldTemplate });
  }));
  router.delete('/field-templates/:templateId', requireAdmin, asyncRoute(async (req, res) => {
    const fieldTemplate = await store.archiveFieldTemplate({ actorUserId: req.auth.user.id, actorRole: req.auth.user.role, id: requirementId(req.params.templateId) });
    audit(req, requestAuditor, 'requirement.field_template.archive', 'requirement_field_template', fieldTemplate.id, { status: fieldTemplate.status }); res.status(204).end();
  }));
  if (draftService) {
    router.get('/drafts', asyncRoute(async (req, res) => res.json({ drafts: await store.listRequirementDrafts({ ownerUserId: req.auth.user.id }) })));
    router.post('/drafts', asyncRoute(async (req, res) => {
      const draft = await draftService.request({ ownerUserId: req.auth.user.id, ...req.body });
      audit(req, requestAuditor, 'requirement.draft.request', 'requirement_draft', draft.id, { sourceConversationId: draft.sourceConversationId, status: draft.status }); res.status(202).json({ draft });
    }));
    router.get('/drafts/:draftId', asyncRoute(async (req, res) => {
      const draft = await draftService.reconcile({ ownerUserId: req.auth.user.id, id: requirementId(req.params.draftId) }); res.json({ draft });
    }));
    router.post('/drafts/:draftId/confirm', asyncRoute(async (req, res) => {
      const result = await draftService.confirm({ ownerUserId: req.auth.user.id, id: requirementId(req.params.draftId), ...req.body });
      audit(req, requestAuditor, 'requirement.draft.confirm', 'requirement_draft', result.draft.id, { requirementId: result.requirement.id }); res.status(201).json(result);
    }));
    router.post('/drafts/:draftId/reject', asyncRoute(async (req, res) => {
      const draft = await store.rejectRequirementDraft({ ownerUserId: req.auth.user.id, id: requirementId(req.params.draftId) });
      audit(req, requestAuditor, 'requirement.draft.reject', 'requirement_draft', draft.id, { status: draft.status }); res.json({ draft });
    }));
  }
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
  router.post('/:requirementId/links', asyncRoute(async (req, res) => {
    const link = await store.addRequirementLink({ ownerUserId: req.auth.user.id, requirementId: requirementId(req.params.requirementId), resourceType: req.body?.resourceType, resourceId: req.body?.resourceId });
    audit(req, requestAuditor, 'requirement.link.create', 'requirement_link', link.id, { requirementId: link.requirementId, resourceType: link.resourceType, resourceId: link.resourceId, versionId: link.versionId }); res.status(201).json({ link });
  }));
  router.delete('/:requirementId/links/:linkId', asyncRoute(async (req, res) => {
    const id = requirementId(req.params.requirementId); const linkId = requirementId(req.params.linkId);
    await store.removeRequirementLink({ ownerUserId: req.auth.user.id, requirementId: id, linkId }); audit(req, requestAuditor, 'requirement.link.remove', 'requirement_link', linkId, { requirementId: id }); res.status(204).end();
  }));
  return router;
}

module.exports = { createRequirementRouter };
