'use strict';

const crypto = require('node:crypto');
const { toIsoTimestamp, toMySqlTimestamp } = require('../users/mysql-user-store');
const { normalizeRequirement, normalizeInteraction, normalizeRequirementQuery } = require('./requirement-input');
const { normalizeFieldTemplate, normalizeFieldValue } = require('./requirement-fields');
const { parseDraftOutput } = require('./requirement-drafts');

function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function validId(value, code) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw failure(code, 'identifier is invalid'); return value; }
function timestamp(clock) { const value = clock(); if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError('clock returned an invalid ISO timestamp'); return toMySqlTimestamp(value); }
function date(value) { return toIsoTimestamp(value); }
function unit(row) { return row && ({ id: row.id, name: row.name, status: row.status, createdByUserId: row.created_by_user_id, createdAt: date(row.created_at), updatedAt: date(row.updated_at) }); }
function interaction(row) { return row && ({ id: row.id, requirementId: row.requirement_id, channel: row.channel, content: row.content, occurredAt: date(row.occurred_at), recordedAt: date(row.recorded_at) }); }
function link(row) { return row && ({ id: row.id, requirementId: row.requirement_id, resourceType: row.resource_type, resourceId: row.resource_id, versionId: row.version_id, title: row.title, createdAt: date(row.created_at) }); }
function json(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}
function template(row) { return row && ({ id: row.id, key: row.field_key, label: row.label, type: row.field_type, options: json(row.options_json), required: Boolean(row.required), status: row.status, schemaVersion: row.schema_version, createdAt: date(row.created_at), updatedAt: date(row.updated_at) }); }
function fieldValue(row) { const schema = json(row.template_snapshot_json); return { templateId: row.template_id, key: schema.key, label: schema.label, type: schema.type, schemaVersion: row.template_schema_version, value: json(row.value_json) }; }
function draft(row) { return row && ({ id: row.id, ownerUserId: row.owner_user_id, sourceConversationId: row.source_conversation_id, sourceFirstSequence: Number(row.source_first_sequence), sourceLastSequence: Number(row.source_last_sequence), sourceSha256: row.source_sha256, gatewayJobId: row.gateway_job_id, status: row.status, draft: row.draft_json ? json(row.draft_json) : null, errorCode: row.error_code, confirmedRequirementId: row.confirmed_requirement_id, createdAt: date(row.created_at), updatedAt: date(row.updated_at), resolvedAt: date(row.resolved_at) }); }
function summary(row) { return row && ({ id: row.id, ownerUserId: row.owner_user_id, responsibleUserId: row.responsible_user_id, buId: row.bu_id, buName: row.bu_name, title: row.title, scenario: row.scenario, description: row.description, status: row.status, createdAt: date(row.created_at), updatedAt: date(row.updated_at) }); }

function createMySqlRequirementStore(db, { idFactory = crypto.randomUUID, clock = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.query !== 'function' || typeof db.one !== 'function' || typeof db.many !== 'function' || typeof db.transaction !== 'function') throw new TypeError('MySQL requirement database is required');
  async function owned(id, ownerUserId, executor = db) {
    const row = await executor.one(`SELECT r.*, b.name AS bu_name FROM requirements r JOIN business_units b ON b.id = r.bu_id WHERE r.id = ? AND r.owner_user_id = ?`, [validId(id, 'INVALID_REQUIREMENT_ID'), validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR')]);
    if (!row) throw failure('REQUIREMENT_NOT_FOUND', 'requirement was not found'); return row;
  }
  function admin({ actorUserId, actorRole } = {}, code = 'BUSINESS_UNIT_NOT_FOUND') { if (actorRole !== 'admin') throw failure(code, 'resource was not found'); return validId(actorUserId, 'INVALID_REQUIREMENT_ACTOR'); }
  async function activeUnit(id, executor = db, { lock = false } = {}) { const result = await executor.one(`SELECT id FROM business_units WHERE id = ? AND status = 'active'${lock ? ' FOR UPDATE' : ''}`, [id]); if (!result) throw failure('BUSINESS_UNIT_NOT_FOUND', 'business unit was not found'); }
  async function createBusinessUnit({ actorUserId, actorRole, name } = {}) {
    const creator = admin({ actorUserId, actorRole }); if (typeof name !== 'string' || !name.trim() || Array.from(name.trim()).length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw failure('INVALID_BUSINESS_UNIT', 'business unit is invalid');
    const id = validId(idFactory(), 'INVALID_BUSINESS_UNIT'); const time = timestamp(clock);
    try { await db.query("INSERT INTO business_units (id, name, status, created_by_user_id, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)", [id, name.trim(), creator, time, time]); }
    catch (error) { if (error?.code === 'ER_DUP_ENTRY') throw failure('BUSINESS_UNIT_EXISTS', 'business unit already exists'); throw error; }
    return unit(await db.one('SELECT * FROM business_units WHERE id = ?', [id]));
  }
  async function listBusinessUnits({ activeOnly = false } = {}) { return (await db.many(`SELECT * FROM business_units ${activeOnly ? "WHERE status = 'active'" : ''} ORDER BY name, id`)).map(unit); }
  async function archiveBusinessUnit({ actorUserId, actorRole, id } = {}) {
    admin({ actorUserId, actorRole }); const unitId = validId(id, 'INVALID_BUSINESS_UNIT');
    return db.transaction(async (tx) => {
      const found = await tx.one('SELECT * FROM business_units WHERE id = ? FOR UPDATE', [unitId]); if (!found) throw failure('BUSINESS_UNIT_NOT_FOUND', 'business unit was not found');
      if (await tx.one("SELECT id FROM requirements WHERE bu_id = ? AND status != 'archived' LIMIT 1", [unitId])) throw failure('BUSINESS_UNIT_IN_USE', 'business unit has active requirements');
      await tx.query("UPDATE business_units SET status = 'archived', updated_at = ? WHERE id = ?", [timestamp(clock), unitId]); return unit(await tx.one('SELECT * FROM business_units WHERE id = ?', [unitId]));
    });
  }
  async function createFieldTemplate({ actorUserId, actorRole, ...body } = {}) {
    const creator = admin({ actorUserId, actorRole }, 'REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND'); const input = normalizeFieldTemplate(body); const id = validId(idFactory(), 'INVALID_REQUIREMENT_FIELD_TEMPLATE'); const time = timestamp(clock);
    try { await db.query("INSERT INTO requirement_field_templates (id, field_key, label, field_type, options_json, required, status, schema_version, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)", [id, input.key, input.label, input.type, JSON.stringify(input.options), input.required, creator, time, time]); }
    catch (error) { if (error?.code === 'ER_DUP_ENTRY') throw failure('REQUIREMENT_FIELD_TEMPLATE_EXISTS', 'requirement field template already exists'); throw error; }
    return template(await db.one('SELECT * FROM requirement_field_templates WHERE id = ?', [id]));
  }
  async function listFieldTemplates({ activeOnly = false } = {}) { return (await db.many(`SELECT * FROM requirement_field_templates ${activeOnly ? "WHERE status = 'active'" : ''} ORDER BY field_key, id`)).map(template); }
  async function updateFieldTemplate({ actorUserId, actorRole, id, ...body } = {}) {
    admin({ actorUserId, actorRole }, 'REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND'); const templateId = validId(id, 'INVALID_REQUIREMENT_FIELD_TEMPLATE');
    return db.transaction(async (tx) => {
      const existing = await tx.one('SELECT * FROM requirement_field_templates WHERE id = ? FOR UPDATE', [templateId]); if (!existing) throw failure('REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND', 'requirement field template was not found');
      const old = template(existing); const patch = normalizeFieldTemplate(body, { patch: true }); const next = normalizeFieldTemplate({ key: patch.key ?? old.key, label: patch.label ?? old.label, type: patch.type ?? old.type, options: patch.options ?? old.options, required: patch.required ?? old.required }); const changed = ['key', 'label', 'type', 'options', 'required'].some((key) => JSON.stringify(next[key]) !== JSON.stringify(old[key]));
      await tx.query('UPDATE requirement_field_templates SET field_key = ?, label = ?, field_type = ?, options_json = ?, required = ?, schema_version = ?, updated_at = ? WHERE id = ?', [next.key, next.label, next.type, JSON.stringify(next.options), next.required, existing.schema_version + (changed ? 1 : 0), timestamp(clock), existing.id]);
      return template(await tx.one('SELECT * FROM requirement_field_templates WHERE id = ?', [existing.id]));
    });
  }
  async function archiveFieldTemplate({ actorUserId, actorRole, id } = {}) {
    admin({ actorUserId, actorRole }, 'REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND'); const templateId = validId(id, 'INVALID_REQUIREMENT_FIELD_TEMPLATE'); const found = await db.one('SELECT * FROM requirement_field_templates WHERE id = ?', [templateId]); if (!found) throw failure('REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND', 'requirement field template was not found'); await db.query("UPDATE requirement_field_templates SET status = 'archived', updated_at = ? WHERE id = ?", [timestamp(clock), templateId]); return template(await db.one('SELECT * FROM requirement_field_templates WHERE id = ?', [templateId]));
  }
  async function replaceFieldValues({ requirementId, ownerUserId, entries, time, executor = db, enforceRequired = false }) {
    if (entries === undefined && !enforceRequired) return;
    const requested = entries || [];
    const normalized = [];
    for (const entry of requested) {
      const row = await executor.one("SELECT * FROM requirement_field_templates WHERE id = ? AND status = 'active' FOR UPDATE", [entry.templateId]); if (!row) throw failure('REQUIREMENT_FIELD_TEMPLATE_NOT_FOUND', 'requirement field template was not found'); const item = template(row); normalized.push({ item, value: normalizeFieldValue(item, entry.value) });
    }
    const required = await executor.many("SELECT id FROM requirement_field_templates WHERE status = 'active' AND required = TRUE FOR UPDATE");
    if (required.some((row) => !normalized.some((entry) => entry.item.id === row.id))) throw failure('REQUIRED_REQUIREMENT_FIELD_VALUE', 'required requirement field value is missing');
    await executor.query('DELETE FROM requirement_field_values WHERE requirement_id = ? AND owner_user_id = ?', [requirementId, ownerUserId]);
    for (const entry of normalized) await executor.query('INSERT INTO requirement_field_values (id, requirement_id, owner_user_id, template_id, template_schema_version, template_snapshot_json, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [validId(idFactory(), 'INVALID_REQUIREMENT_FIELD_VALUE'), requirementId, ownerUserId, entry.item.id, entry.item.schemaVersion, JSON.stringify({ key: entry.item.key, label: entry.item.label, type: entry.item.type, options: entry.item.options, required: entry.item.required }), JSON.stringify(entry.value), time, time]);
  }
  async function ownedDraft(id, ownerUserId, executor = db) { const row = await executor.one('SELECT * FROM requirement_drafts WHERE id = ? AND owner_user_id = ?', [validId(id, 'INVALID_REQUIREMENT_DRAFT'), validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR')]); if (!row) throw failure('REQUIREMENT_DRAFT_NOT_FOUND', 'requirement draft was not found'); return row; }
  async function createRequirementDraft({ ownerUserId, sourceConversationId, sourceFirstSequence, sourceLastSequence, sourceSha256, gatewayJobId } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const conversationId = validId(sourceConversationId, 'INVALID_REQUIREMENT_DRAFT'); const jobId = validId(gatewayJobId, 'INVALID_REQUIREMENT_DRAFT');
    if (!Number.isSafeInteger(sourceFirstSequence) || !Number.isSafeInteger(sourceLastSequence) || sourceFirstSequence < 1 || sourceLastSequence < sourceFirstSequence || sourceLastSequence - sourceFirstSequence >= 1000 || typeof sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourceSha256)) throw failure('INVALID_REQUIREMENT_DRAFT', 'requirement draft is invalid');
    return db.transaction(async (tx) => {
      const conversation = await tx.one("SELECT id FROM conversations WHERE id = ? AND owner_user_id = ? AND status = 'active' FOR UPDATE", [conversationId, owner]); const job = await tx.one('SELECT id FROM gateway_jobs WHERE id = ? AND conversation_id = ? AND user_id = ? FOR UPDATE', [jobId, conversationId, owner]); if (!conversation || !job) throw failure('REQUIREMENT_DRAFT_SOURCE_NOT_FOUND', 'requirement draft source was not found');
      const id = validId(idFactory(), 'INVALID_REQUIREMENT_DRAFT'); const time = timestamp(clock); await tx.query("INSERT INTO requirement_drafts (id, owner_user_id, source_conversation_id, source_first_sequence, source_last_sequence, source_sha256, gateway_job_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'generating', ?, ?)", [id, owner, conversationId, sourceFirstSequence, sourceLastSequence, sourceSha256, jobId, time, time]); return draft(await tx.one('SELECT * FROM requirement_drafts WHERE id = ?', [id]));
    });
  }
  async function getRequirementDraft({ ownerUserId, id } = {}) { return draft(await ownedDraft(id, ownerUserId)); }
  async function findRequirementDraftByGatewayJob({ ownerUserId, gatewayJobId } = {}) { const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const jobId = validId(gatewayJobId, 'INVALID_REQUIREMENT_DRAFT'); return draft(await db.one('SELECT * FROM requirement_drafts WHERE owner_user_id = ? AND gateway_job_id = ?', [owner, jobId])); }
  async function listRequirementDrafts({ ownerUserId } = {}) { const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); return (await db.many('SELECT * FROM requirement_drafts WHERE owner_user_id = ? ORDER BY updated_at DESC, id DESC', [owner])).map(draft); }
  async function resolveRequirementDraft({ ownerUserId, id, draft: output } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); return db.transaction(async (tx) => { const existing = await ownedDraft(id, owner, tx); if (existing.status !== 'generating') return draft(existing); const parsed = parseDraftOutput(JSON.stringify(output)); const time = timestamp(clock); await tx.query("UPDATE requirement_drafts SET status = 'ready', draft_json = ?, error_code = NULL, updated_at = ?, resolved_at = ? WHERE id = ? AND owner_user_id = ? AND status = 'generating'", [JSON.stringify(parsed), time, time, existing.id, owner]); return draft(await tx.one('SELECT * FROM requirement_drafts WHERE id = ?', [existing.id])); });
  }
  async function failRequirementDraft({ ownerUserId, id, errorCode } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); if (typeof errorCode !== 'string' || !/^[A-Z0-9_]{1,100}$/.test(errorCode)) throw failure('INVALID_REQUIREMENT_DRAFT', 'requirement draft is invalid'); return db.transaction(async (tx) => { const existing = await ownedDraft(id, owner, tx); if (existing.status !== 'generating') return draft(existing); const time = timestamp(clock); await tx.query("UPDATE requirement_drafts SET status = 'failed', error_code = ?, updated_at = ?, resolved_at = ? WHERE id = ? AND owner_user_id = ? AND status = 'generating'", [errorCode, time, time, existing.id, owner]); return draft(await tx.one('SELECT * FROM requirement_drafts WHERE id = ?', [existing.id])); });
  }
  async function rejectRequirementDraft({ ownerUserId, id } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); return db.transaction(async (tx) => { const existing = await ownedDraft(id, owner, tx); if (!['generating', 'ready', 'failed'].includes(existing.status)) return draft(existing); const time = timestamp(clock); await tx.query("UPDATE requirement_drafts SET status = 'rejected', updated_at = ?, resolved_at = ? WHERE id = ? AND owner_user_id = ?", [time, time, existing.id, owner]); return draft(await tx.one('SELECT * FROM requirement_drafts WHERE id = ?', [existing.id])); });
  }
  async function confirmRequirementDraft({ ownerUserId, id, buId, title, scenario, description, status, fieldValues } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR');
    return db.transaction(async (tx) => {
      const existing = await ownedDraft(id, owner, tx);
      if (existing.status === 'confirmed') {
        const requirement = summary(await owned(existing.confirmed_requirement_id, owner, tx));
        return { draft: draft(existing), requirement };
      }
      if (existing.status !== 'ready') throw failure('REQUIREMENT_DRAFT_NOT_READY', 'requirement draft is not ready');
      const output = json(existing.draft_json); const input = normalizeRequirement({ title: title ?? output.title, buId, scenario: scenario ?? output.scenario, description: description ?? output.description, status: status ?? 'draft', fieldValues: fieldValues ?? output.fieldValues });
      await activeUnit(input.buId, tx, { lock: true }); const requirementId = validId(idFactory(), 'INVALID_REQUIREMENT_ID'); const time = timestamp(clock);
      await tx.query('INSERT INTO requirements (id, owner_user_id, responsible_user_id, bu_id, title, scenario, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [requirementId, owner, owner, input.buId, input.title, input.scenario, input.description, input.status, time, time]);
      await replaceFieldValues({ requirementId, ownerUserId: owner, entries: input.fieldValues, time, executor: tx, enforceRequired: true });
      await tx.query("UPDATE requirement_drafts SET status = 'confirmed', confirmed_requirement_id = ?, updated_at = ?, resolved_at = ? WHERE id = ? AND owner_user_id = ? AND status = 'ready'", [requirementId, time, time, existing.id, owner]);
      return { draft: draft(await tx.one('SELECT * FROM requirement_drafts WHERE id = ?', [existing.id])), requirement: summary(await owned(requirementId, owner, tx)) };
    });
  }
  async function createRequirement({ ownerUserId, ...body } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const input = normalizeRequirement(body);
    const id = validId(idFactory(), 'INVALID_REQUIREMENT_ID'); const time = timestamp(clock);
    await db.transaction(async (tx) => {
      await activeUnit(input.buId, tx, { lock: true });
      await tx.query('INSERT INTO requirements (id, owner_user_id, responsible_user_id, bu_id, title, scenario, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, owner, owner, input.buId, input.title, input.scenario, input.description, input.status, time, time]);
      await replaceFieldValues({ requirementId: id, ownerUserId: owner, entries: input.fieldValues, time, executor: tx, enforceRequired: true });
    });
    return summary(await db.one('SELECT r.*, b.name AS bu_name FROM requirements r JOIN business_units b ON b.id = r.bu_id WHERE r.id = ?', [id]));
  }
  async function linksFor(requirementId, executor = db) {
    return (await executor.many(`SELECT l.*, COALESCE(c.title, kv.title, sv.title) AS title
      FROM requirement_links l
      LEFT JOIN conversations c ON l.resource_type = 'conversation' AND c.id = l.resource_id
      LEFT JOIN knowledge_versions kv ON l.resource_type = 'knowledge' AND kv.id = l.version_id
      LEFT JOIN solution_versions sv ON l.resource_type = 'solution' AND sv.id = l.version_id
      WHERE l.requirement_id = ? ORDER BY l.created_at DESC, l.id DESC`, [requirementId])).map(link);
  }
  async function getRequirement({ ownerUserId, id } = {}) { const item = summary(await owned(id, ownerUserId)); return { ...item, interactions: (await db.many('SELECT * FROM requirement_interactions WHERE requirement_id = ? ORDER BY occurred_at DESC, id DESC', [item.id])).map(interaction), links: await linksFor(item.id), fieldValues: (await db.many('SELECT * FROM requirement_field_values WHERE requirement_id = ? ORDER BY created_at, id', [item.id])).map(fieldValue) }; }
  async function updateRequirement({ ownerUserId, id, ...body } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const existing = await owned(id, owner); const input = normalizeRequirement(body, { patch: true }); if (input.buId) await activeUnit(input.buId);
    const { fieldValues, ...fieldsInput } = input; const fields = Object.keys(fieldsInput); const values = fields.map((key) => fieldsInput[key]); const time = timestamp(clock);
    await db.transaction(async (tx) => { if (fields.length) await tx.query(`UPDATE requirements SET ${fields.map((key) => `${key === 'buId' ? 'bu_id' : key} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND owner_user_id = ?`, [...values, time, existing.id, owner]); await replaceFieldValues({ requirementId: existing.id, ownerUserId: owner, entries: fieldValues, time, executor: tx }); });
    return summary(await owned(existing.id, owner));
  }
  async function addInteraction({ ownerUserId, requirementId, ...body } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const requirement = await owned(requirementId, owner); const input = normalizeInteraction(body); const id = validId(idFactory(), 'INVALID_REQUIREMENT_INTERACTION');
    await db.query('INSERT INTO requirement_interactions (id, requirement_id, owner_user_id, channel, content, occurred_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, requirement.id, owner, input.channel, input.content, toMySqlTimestamp(input.occurredAt), timestamp(clock)]);
    return interaction(await db.one('SELECT * FROM requirement_interactions WHERE id = ?', [id]));
  }
  async function source(ownerUserId, resourceType, resourceId, executor = db) {
    if (!['conversation', 'knowledge', 'solution'].includes(resourceType)) throw failure('INVALID_REQUIREMENT_LINK', 'requirement link is invalid'); const resource = validId(resourceId, 'INVALID_REQUIREMENT_LINK');
    if (resourceType === 'conversation') {
      const found = await executor.one("SELECT id, title FROM conversations WHERE id = ? AND owner_user_id = ? AND status = 'active'", [resource, ownerUserId]);
      return found ? { resourceId: found.id, versionId: null, title: found.title } : null;
    }
    const table = resourceType === 'knowledge' ? 'knowledge_documents' : 'solutions'; const versions = resourceType === 'knowledge' ? 'knowledge_versions' : 'solution_versions';
    const found = await executor.one(`SELECT d.id AS resource_id, v.id AS version_id, v.title FROM ${table} d JOIN ${versions} v ON v.id = d.current_version_id WHERE d.id = ? AND d.owner_user_id = ?`, [resource, ownerUserId]);
    return found ? { resourceId: found.resource_id, versionId: found.version_id, title: found.title } : null;
  }
  async function addRequirementLink({ ownerUserId, requirementId, resourceType, resourceId } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const requirement = await owned(requirementId, owner); const target = await source(owner, resourceType, resourceId); if (!target) throw failure('REQUIREMENT_LINK_TARGET_NOT_FOUND', 'link target was not found'); const id = validId(idFactory(), 'INVALID_REQUIREMENT_LINK');
    try { await db.query('INSERT INTO requirement_links (id, requirement_id, owner_user_id, resource_type, resource_id, version_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, requirement.id, owner, resourceType, target.resourceId, target.versionId, timestamp(clock)]); }
    catch (error) { if (error?.code === 'ER_DUP_ENTRY') throw failure('REQUIREMENT_LINK_EXISTS', 'requirement link already exists'); throw error; }
    return (await linksFor(requirement.id)).find((item) => item.id === id);
  }
  async function removeRequirementLink({ ownerUserId, requirementId, linkId } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const requirement = await owned(requirementId, owner); const result = await db.query('DELETE FROM requirement_links WHERE id = ? AND requirement_id = ? AND owner_user_id = ?', [validId(linkId, 'INVALID_REQUIREMENT_LINK'), requirement.id, owner]); if (Number(result.affectedRows) !== 1) throw failure('REQUIREMENT_LINK_NOT_FOUND', 'requirement link was not found');
  }
  async function listRequirements({ ownerUserId, query, ...filters } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const input = normalizeRequirementQuery({ ...filters, ...(query === undefined ? {} : { q: query }) }); const clauses = ['r.owner_user_id = ?']; const values = [owner];
    if (input.buId) { clauses.push('r.bu_id = ?'); values.push(input.buId); } if (input.status) { clauses.push('r.status = ?'); values.push(input.status); }
    if (input.query) { clauses.push("(r.title LIKE ? ESCAPE '\\\\' OR r.scenario LIKE ? ESCAPE '\\\\' OR r.description LIKE ? ESCAPE '\\\\')"); const escaped = `%${input.query.replace(/[\\%_]/g, '\\$&')}%`; values.push(escaped, escaped, escaped); }
    const where = clauses.join(' AND '); const total = Number((await db.one(`SELECT COUNT(*) AS count FROM requirements r WHERE ${where}`, values))?.count || 0);
    const rows = await db.many(`SELECT r.*, b.name AS bu_name FROM requirements r JOIN business_units b ON b.id = r.bu_id WHERE ${where} ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`, [...values, input.limit, input.offset]); return { items: rows.map(summary), total, limit: input.limit, offset: input.offset };
  }
  return Object.freeze({ createBusinessUnit, listBusinessUnits, archiveBusinessUnit, createFieldTemplate, listFieldTemplates, updateFieldTemplate, archiveFieldTemplate, createRequirementDraft, getRequirementDraft, findRequirementDraftByGatewayJob, listRequirementDrafts, resolveRequirementDraft, failRequirementDraft, rejectRequirementDraft, confirmRequirementDraft, createRequirement, getRequirement, updateRequirement, addInteraction, addRequirementLink, removeRequirementLink, listRequirements });
}

module.exports = { createMySqlRequirementStore };
