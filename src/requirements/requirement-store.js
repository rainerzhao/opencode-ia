'use strict';

const crypto = require('node:crypto');
const { normalizeRequirement, normalizeInteraction, normalizeRequirementQuery } = require('./requirement-input');
const { normalizeFieldTemplate, normalizeFieldValue } = require('./requirement-fields');
const { parseDraftOutput } = require('./requirement-drafts');

function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function validId(value, code) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw failure(code, 'identifier is invalid'); return value; }
function now(clock) { const value = clock(); if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError('clock returned an invalid ISO timestamp'); return value; }
function unit(row) { return row && ({ id: row.id, name: row.name, status: row.status, createdByUserId: row.created_by_user_id, createdAt: row.created_at, updatedAt: row.updated_at }); }
function interaction(row) { return row && ({ id: row.id, requirementId: row.requirement_id, channel: row.channel, content: row.content, occurredAt: row.occurred_at, recordedAt: row.recorded_at }); }
function link(row) { return row && ({ id: row.id, requirementId: row.requirement_id, resourceType: row.resource_type, resourceId: row.resource_id, versionId: row.version_id, title: row.title, createdAt: row.created_at }); }
function template(row) { return row && ({ id: row.id, key: row.field_key, label: row.label, type: row.field_type, options: JSON.parse(row.options_json), required: Boolean(row.required), status: row.status, schemaVersion: row.schema_version, createdAt: row.created_at, updatedAt: row.updated_at }); }
function fieldValue(row) { const schema = JSON.parse(row.template_snapshot_json); return { templateId: row.template_id, key: schema.key, label: schema.label, type: schema.type, schemaVersion: row.template_schema_version, value: JSON.parse(row.value_json) }; }
function draft(row) { return row && ({ id: row.id, ownerUserId: row.owner_user_id, sourceConversationId: row.source_conversation_id, sourceFirstSequence: row.source_first_sequence, sourceLastSequence: row.source_last_sequence, sourceSha256: row.source_sha256, gatewayJobId: row.gateway_job_id, status: row.status, draft: row.draft_json ? JSON.parse(row.draft_json) : null, errorCode: row.error_code, confirmedRequirementId: row.confirmed_requirement_id, createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at }); }
function summary(row) { return row && ({ id: row.id, ownerUserId: row.owner_user_id, responsibleUserId: row.responsible_user_id, buId: row.bu_id, buName: row.bu_name, title: row.title, scenario: row.scenario, description: row.description, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }); }

function createRequirementStore(db, { idFactory = crypto.randomUUID, clock = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('requirement database is required');
  const selectRequirement = db.prepare(`SELECT r.*, b.name AS bu_name FROM requirements r JOIN business_units b ON b.id = r.bu_id WHERE r.id = ? AND r.owner_user_id = ?`);
  const interactions = db.prepare('SELECT * FROM requirement_interactions WHERE requirement_id = ? ORDER BY occurred_at DESC, id DESC');
  const links = db.prepare(`SELECT l.*, COALESCE(c.title, kv.title, sv.title) AS title
    FROM requirement_links l
    LEFT JOIN conversations c ON l.resource_type = 'conversation' AND c.id = l.resource_id
    LEFT JOIN knowledge_versions kv ON l.resource_type = 'knowledge' AND kv.id = l.version_id
    LEFT JOIN solution_versions sv ON l.resource_type = 'solution' AND sv.id = l.version_id
    WHERE l.requirement_id = ? ORDER BY l.created_at DESC, l.id DESC`);
  const activeUnit = db.prepare("SELECT * FROM business_units WHERE id = ? AND status = 'active'");
  const activeTemplate = db.prepare("SELECT * FROM requirement_field_templates WHERE id = ? AND status = 'active'");
  const selectTemplate = db.prepare('SELECT * FROM requirement_field_templates WHERE id = ?');
  const valuesFor = db.prepare('SELECT * FROM requirement_field_values WHERE requirement_id = ? ORDER BY created_at, id');
  const draftByOwner = db.prepare('SELECT * FROM requirement_drafts WHERE id = ? AND owner_user_id = ?');

  function mustOwn(id, ownerUserId) { const row = selectRequirement.get(validId(id, 'INVALID_REQUIREMENT_ID'), validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR')); if (!row) throw failure('REQUIREMENT_NOT_FOUND', 'requirement was not found'); return row; }
  function mustAdmin(actor, code = 'BUSINESS_UNIT_NOT_FOUND') { if (actor?.actorRole !== 'admin') throw failure(code, 'resource was not found'); return validId(actor.actorUserId, 'INVALID_REQUIREMENT_ACTOR'); }
  function transaction(action) { db.exec('BEGIN IMMEDIATE'); try { const result = action(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }

  function createBusinessUnit({ actorUserId, actorRole, name } = {}) {
    const creator = mustAdmin({ actorUserId, actorRole });
    if (typeof name !== 'string' || !name.trim() || Array.from(name.trim()).length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw failure('INVALID_BUSINESS_UNIT', 'business unit is invalid');
    const id = validId(idFactory(), 'INVALID_BUSINESS_UNIT'); const time = now(clock);
    try { db.prepare('INSERT INTO business_units (id, name, status, created_by_user_id, created_at, updated_at) VALUES (?, ?, \'active\', ?, ?, ?)').run(id, name.trim(), creator, time, time); }
    catch (error) { if (String(error.message).includes('UNIQUE')) throw failure('BUSINESS_UNIT_EXISTS', 'business unit already exists'); throw error; }
    return unit(db.prepare('SELECT * FROM business_units WHERE id = ?').get(id));
  }
  function listBusinessUnits({ activeOnly = false } = {}) { return db.prepare(`SELECT * FROM business_units ${activeOnly ? "WHERE status = 'active'" : ''} ORDER BY name, id`).all().map(unit); }
  function archiveBusinessUnit({ actorUserId, actorRole, id } = {}) {
    mustAdmin({ actorUserId, actorRole }); const unitId = validId(id, 'INVALID_BUSINESS_UNIT');
    return transaction(() => {
      const found = db.prepare('SELECT * FROM business_units WHERE id = ?').get(unitId); if (!found) throw failure('BUSINESS_UNIT_NOT_FOUND', 'business unit was not found');
      if (db.prepare("SELECT 1 FROM requirements WHERE bu_id = ? AND status != 'archived' LIMIT 1").get(unitId)) throw failure('BUSINESS_UNIT_IN_USE', 'business unit has active requirements');
      db.prepare("UPDATE business_units SET status = 'archived', updated_at = ? WHERE id = ?").run(now(clock), unitId); return unit(db.prepare('SELECT * FROM business_units WHERE id = ?').get(unitId));
    });
  }
  function createFieldTemplate({ actorUserId, actorRole, ...body } = {}) {
    const creator = mustAdmin({ actorUserId, actorRole }, 'REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND'); const input = normalizeFieldTemplate(body);
    const id = validId(idFactory(), 'INVALID_REQUIREMENT_FIELD_TEMPLATE'); const time = now(clock);
    try { db.prepare("INSERT INTO requirement_field_templates (id, field_key, label, field_type, options_json, required, status, schema_version, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)").run(id, input.key, input.label, input.type, JSON.stringify(input.options), Number(input.required), creator, time, time); }
    catch (error) { if (String(error.message).includes('UNIQUE')) throw failure('REQUIREMENT_FIELD_TEMPLATE_EXISTS', 'requirement field template already exists'); throw error; }
    return template(selectTemplate.get(id));
  }
  function listFieldTemplates({ activeOnly = false } = {}) { return db.prepare(`SELECT * FROM requirement_field_templates ${activeOnly ? "WHERE status = 'active'" : ''} ORDER BY field_key, id`).all().map(template); }
  function updateFieldTemplate({ actorUserId, actorRole, id, ...body } = {}) {
    mustAdmin({ actorUserId, actorRole }, 'REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND'); const existing = selectTemplate.get(validId(id, 'INVALID_REQUIREMENT_FIELD_TEMPLATE')); if (!existing) throw failure('REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND', 'requirement field template was not found');
    const patch = normalizeFieldTemplate(body, { patch: true }); const old = template(existing); const next = normalizeFieldTemplate({ key: patch.key ?? old.key, label: patch.label ?? old.label, type: patch.type ?? old.type, options: patch.options ?? old.options, required: patch.required ?? old.required }); const changed = ['key', 'label', 'type', 'options', 'required'].some((key) => JSON.stringify(next[key]) !== JSON.stringify(old[key]));
    db.prepare('UPDATE requirement_field_templates SET field_key = ?, label = ?, field_type = ?, options_json = ?, required = ?, schema_version = ?, updated_at = ? WHERE id = ?').run(next.key, next.label, next.type, JSON.stringify(next.options), Number(next.required), existing.schema_version + (changed ? 1 : 0), now(clock), existing.id);
    return template(selectTemplate.get(existing.id));
  }
  function archiveFieldTemplate({ actorUserId, actorRole, id } = {}) {
    mustAdmin({ actorUserId, actorRole }, 'REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND'); const item = selectTemplate.get(validId(id, 'INVALID_REQUIREMENT_FIELD_TEMPLATE')); if (!item) throw failure('REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND', 'requirement field template was not found');
    db.prepare("UPDATE requirement_field_templates SET status = 'archived', updated_at = ? WHERE id = ?").run(now(clock), item.id); return template(selectTemplate.get(item.id));
  }
  function replaceFieldValues({ requirementId, ownerUserId, entries, time, enforceRequired = false }) {
    if (entries === undefined && !enforceRequired) return;
    const requested = entries || [];
    const normalized = requested.map((entry) => {
      const row = activeTemplate.get(entry.templateId); if (!row) throw failure('REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND', 'requirement field template was not found');
      const item = template(row); const value = normalizeFieldValue(item, entry.value);
      return { item, value };
    });
    const required = db.prepare("SELECT id FROM requirement_field_templates WHERE status = 'active' AND required = 1").all();
    if (required.some((row) => !normalized.some((entry) => entry.item.id === row.id))) throw failure('REQUIRED_REQUIREMENT_FIELD_VALUE', 'required requirement field value is missing');
    db.prepare('DELETE FROM requirement_field_values WHERE requirement_id = ? AND owner_user_id = ?').run(requirementId, ownerUserId);
    const insert = db.prepare('INSERT INTO requirement_field_values (id, requirement_id, owner_user_id, template_id, template_schema_version, template_snapshot_json, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const entry of normalized) insert.run(validId(idFactory(), 'INVALID_REQUIREMENT_FIELD_VALUE'), requirementId, ownerUserId, entry.item.id, entry.item.schemaVersion, JSON.stringify({ key: entry.item.key, label: entry.item.label, type: entry.item.type, options: entry.item.options, required: entry.item.required }), JSON.stringify(entry.value), time, time);
  }
  function ownedDraft(id, ownerUserId) { const row = draftByOwner.get(validId(id, 'INVALID_REQUIREMENT_DRAFT'), validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR')); if (!row) throw failure('REQUIREMENT_DRAFT_NOT_FOUND', 'requirement draft was not found'); return row; }
  function createRequirementDraft({ ownerUserId, sourceConversationId, sourceFirstSequence, sourceLastSequence, sourceSha256, gatewayJobId } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const conversationId = validId(sourceConversationId, 'INVALID_REQUIREMENT_DRAFT'); const jobId = validId(gatewayJobId, 'INVALID_REQUIREMENT_DRAFT');
    if (!Number.isSafeInteger(sourceFirstSequence) || !Number.isSafeInteger(sourceLastSequence) || sourceFirstSequence < 1 || sourceLastSequence < sourceFirstSequence || sourceLastSequence - sourceFirstSequence >= 1000 || typeof sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourceSha256)) throw failure('INVALID_REQUIREMENT_DRAFT', 'requirement draft is invalid');
    const conversation = db.prepare("SELECT id FROM conversations WHERE id = ? AND owner_user_id = ? AND status = 'active'").get(conversationId, owner); const job = db.prepare('SELECT id FROM gateway_jobs WHERE id = ? AND conversation_id = ? AND user_id = ?').get(jobId, conversationId, owner);
    if (!conversation || !job) throw failure('REQUIREMENT_DRAFT_SOURCE_NOT_FOUND', 'requirement draft source was not found'); const id = validId(idFactory(), 'INVALID_REQUIREMENT_DRAFT'); const time = now(clock);
    db.prepare("INSERT INTO requirement_drafts (id, owner_user_id, source_conversation_id, source_first_sequence, source_last_sequence, source_sha256, gateway_job_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'generating', ?, ?)").run(id, owner, conversationId, sourceFirstSequence, sourceLastSequence, sourceSha256, jobId, time, time); return draft(draftByOwner.get(id, owner));
  }
  function getRequirementDraft({ ownerUserId, id } = {}) { return draft(ownedDraft(id, ownerUserId)); }
  function findRequirementDraftByGatewayJob({ ownerUserId, gatewayJobId } = {}) { const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const jobId = validId(gatewayJobId, 'INVALID_REQUIREMENT_DRAFT'); return draft(db.prepare('SELECT * FROM requirement_drafts WHERE owner_user_id = ? AND gateway_job_id = ?').get(owner, jobId)); }
  function listRequirementDrafts({ ownerUserId } = {}) { const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); return db.prepare('SELECT * FROM requirement_drafts WHERE owner_user_id = ? ORDER BY updated_at DESC, id DESC').all(owner).map(draft); }
  function resolveRequirementDraft({ ownerUserId, id, draft: output } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const existing = ownedDraft(id, owner); if (existing.status !== 'generating') return draft(existing); const parsed = parseDraftOutput(JSON.stringify(output)); const time = now(clock);
    db.prepare("UPDATE requirement_drafts SET status = 'ready', draft_json = ?, error_code = NULL, updated_at = ?, resolved_at = ? WHERE id = ? AND owner_user_id = ? AND status = 'generating'").run(JSON.stringify(parsed), time, time, existing.id, owner); return draft(draftByOwner.get(existing.id, owner));
  }
  function failRequirementDraft({ ownerUserId, id, errorCode } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const existing = ownedDraft(id, owner); if (existing.status !== 'generating') return draft(existing); if (typeof errorCode !== 'string' || !/^[A-Z0-9_]{1,100}$/.test(errorCode)) throw failure('INVALID_REQUIREMENT_DRAFT', 'requirement draft is invalid'); const time = now(clock);
    db.prepare("UPDATE requirement_drafts SET status = 'failed', error_code = ?, updated_at = ?, resolved_at = ? WHERE id = ? AND owner_user_id = ? AND status = 'generating'").run(errorCode, time, time, existing.id, owner); return draft(draftByOwner.get(existing.id, owner));
  }
  function rejectRequirementDraft({ ownerUserId, id } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const existing = ownedDraft(id, owner); if (!['generating', 'ready', 'failed'].includes(existing.status)) return draft(existing); const time = now(clock);
    db.prepare("UPDATE requirement_drafts SET status = 'rejected', updated_at = ?, resolved_at = ? WHERE id = ? AND owner_user_id = ?").run(time, time, existing.id, owner); return draft(draftByOwner.get(existing.id, owner));
  }
  function confirmRequirementDraft({ ownerUserId, id, buId, title, scenario, description, status, fieldValues } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR');
    return transaction(() => {
      const existing = ownedDraft(id, owner);
      if (existing.status === 'confirmed') {
        const requirement = summary(selectRequirement.get(existing.confirmed_requirement_id, owner));
        if (!requirement) throw failure('REQUIREMENT_DRAFT_NOT_FOUND', 'requirement draft was not found');
        return { draft: draft(existing), requirement };
      }
      if (existing.status !== 'ready') throw failure('REQUIREMENT_DRAFT_NOT_READY', 'requirement draft is not ready');
      const output = JSON.parse(existing.draft_json);
      const input = normalizeRequirement({ title: title ?? output.title, buId, scenario: scenario ?? output.scenario, description: description ?? output.description, status: status ?? 'draft', fieldValues: fieldValues ?? output.fieldValues });
      const requirementId = validId(idFactory(), 'INVALID_REQUIREMENT_ID'); const time = now(clock);
      if (!activeUnit.get(input.buId)) throw failure('BUSINESS_UNIT_NOT_FOUND', 'business unit was not found');
      db.prepare('INSERT INTO requirements (id, owner_user_id, responsible_user_id, bu_id, title, scenario, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(requirementId, owner, owner, input.buId, input.title, input.scenario, input.description, input.status, time, time);
      replaceFieldValues({ requirementId, ownerUserId: owner, entries: input.fieldValues, time, enforceRequired: true });
      db.prepare("UPDATE requirement_drafts SET status = 'confirmed', confirmed_requirement_id = ?, updated_at = ?, resolved_at = ? WHERE id = ? AND owner_user_id = ? AND status = 'ready'").run(requirementId, time, time, existing.id, owner);
      return { draft: draft(draftByOwner.get(existing.id, owner)), requirement: summary(selectRequirement.get(requirementId, owner)) };
    });
  }
  function createRequirement({ ownerUserId, ...body } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const input = normalizeRequirement(body);
    const id = validId(idFactory(), 'INVALID_REQUIREMENT_ID'); const time = now(clock);
    transaction(() => {
      if (!activeUnit.get(input.buId)) throw failure('BUSINESS_UNIT_NOT_FOUND', 'business unit was not found');
      db.prepare('INSERT INTO requirements (id, owner_user_id, responsible_user_id, bu_id, title, scenario, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, owner, owner, input.buId, input.title, input.scenario, input.description, input.status, time, time);
      replaceFieldValues({ requirementId: id, ownerUserId: owner, entries: input.fieldValues, time, enforceRequired: true });
    });
    return summary(selectRequirement.get(id, owner));
  }
  function getRequirement({ ownerUserId, id } = {}) { const item = summary(mustOwn(id, ownerUserId)); return { ...item, interactions: interactions.all(item.id).map(interaction), links: links.all(item.id).map(link), fieldValues: valuesFor.all(item.id).map(fieldValue) }; }
  function updateRequirement({ ownerUserId, id, ...body } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const existing = mustOwn(id, owner); const input = normalizeRequirement(body, { patch: true });
    if (input.buId && !activeUnit.get(input.buId)) throw failure('BUSINESS_UNIT_NOT_FOUND', 'business unit was not found');
    const { fieldValues, ...fieldsInput } = input; const fields = Object.keys(fieldsInput); const values = fields.map((key) => fieldsInput[key]); const time = now(clock);
    transaction(() => {
      if (fields.length) db.prepare(`UPDATE requirements SET ${fields.map((key) => `${key === 'buId' ? 'bu_id' : key} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND owner_user_id = ?`).run(...values, time, existing.id, owner);
      if (fieldValues !== undefined) replaceFieldValues({ requirementId: existing.id, ownerUserId: owner, entries: fieldValues, time });
    });
    return summary(selectRequirement.get(existing.id, owner));
  }
  function addInteraction({ ownerUserId, requirementId, ...body } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const requirement = mustOwn(requirementId, owner); const input = normalizeInteraction(body); const id = validId(idFactory(), 'INVALID_REQUIREMENT_INTERACTION');
    db.prepare('INSERT INTO requirement_interactions (id, requirement_id, owner_user_id, channel, content, occurred_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, requirement.id, owner, input.channel, input.content, input.occurredAt, now(clock));
    return interaction(db.prepare('SELECT * FROM requirement_interactions WHERE id = ?').get(id));
  }
  function source(ownerUserId, resourceType, resourceId) {
    if (!['conversation', 'knowledge', 'solution'].includes(resourceType)) throw failure('INVALID_REQUIREMENT_LINK', 'requirement link is invalid');
    const resource = validId(resourceId, 'INVALID_REQUIREMENT_LINK');
    if (resourceType === 'conversation') {
      const found = db.prepare("SELECT id, title FROM conversations WHERE id = ? AND owner_user_id = ? AND status = 'active'").get(resource, ownerUserId);
      return found ? { resourceId: found.id, versionId: null, title: found.title } : null;
    }
    const table = resourceType === 'knowledge' ? 'knowledge_documents' : 'solutions'; const versions = resourceType === 'knowledge' ? 'knowledge_versions' : 'solution_versions';
    const found = db.prepare(`SELECT d.id AS resource_id, v.id AS version_id, v.title FROM ${table} d JOIN ${versions} v ON v.id = d.current_version_id WHERE d.id = ? AND d.owner_user_id = ?`).get(resource, ownerUserId);
    return found ? { resourceId: found.resource_id, versionId: found.version_id, title: found.title } : null;
  }
  function addRequirementLink({ ownerUserId, requirementId, resourceType, resourceId } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const requirement = mustOwn(requirementId, owner); const target = source(owner, resourceType, resourceId); if (!target) throw failure('REQUIREMENT_LINK_TARGET_NOT_FOUND', 'link target was not found');
    const id = validId(idFactory(), 'INVALID_REQUIREMENT_LINK'); try { db.prepare('INSERT INTO requirement_links (id, requirement_id, owner_user_id, resource_type, resource_id, version_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, requirement.id, owner, resourceType, target.resourceId, target.versionId, now(clock)); }
    catch (error) { if (String(error.message).includes('UNIQUE')) throw failure('REQUIREMENT_LINK_EXISTS', 'requirement link already exists'); throw error; }
    return link(links.all(requirement.id).find((item) => item.id === id));
  }
  function removeRequirementLink({ ownerUserId, requirementId, linkId } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const requirement = mustOwn(requirementId, owner); const result = db.prepare('DELETE FROM requirement_links WHERE id = ? AND requirement_id = ? AND owner_user_id = ?').run(validId(linkId, 'INVALID_REQUIREMENT_LINK'), requirement.id, owner);
    if (result.changes !== 1) throw failure('REQUIREMENT_LINK_NOT_FOUND', 'requirement link was not found');
  }
  function listRequirements({ ownerUserId, query, ...filters } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const input = normalizeRequirementQuery({ ...filters, ...(query === undefined ? {} : { q: query }) }); const clauses = ['r.owner_user_id = ?']; const values = [owner];
    if (input.buId) { clauses.push('r.bu_id = ?'); values.push(input.buId); }
    if (input.status) { clauses.push('r.status = ?'); values.push(input.status); }
    if (input.query) { clauses.push("(r.title LIKE ? ESCAPE '\\' OR r.scenario LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\')"); const escaped = `%${input.query.replace(/[\\%_]/g, '\\$&')}%`; values.push(escaped, escaped, escaped); }
    const where = clauses.join(' AND '); const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM requirements r WHERE ${where}`).get(...values).count);
    const rows = db.prepare(`SELECT r.*, b.name AS bu_name FROM requirements r JOIN business_units b ON b.id = r.bu_id WHERE ${where} ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(...values, input.limit, input.offset).map(summary);
    return { items: rows, total, limit: input.limit, offset: input.offset };
  }
  return Object.freeze({ createBusinessUnit, listBusinessUnits, archiveBusinessUnit, createFieldTemplate, listFieldTemplates, updateFieldTemplate, archiveFieldTemplate, createRequirementDraft, getRequirementDraft, findRequirementDraftByGatewayJob, listRequirementDrafts, resolveRequirementDraft, failRequirementDraft, rejectRequirementDraft, confirmRequirementDraft, createRequirement, getRequirement, updateRequirement, addInteraction, addRequirementLink, removeRequirementLink, listRequirements });
}

module.exports = { createRequirementStore };
