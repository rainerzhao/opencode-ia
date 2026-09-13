'use strict';

const crypto = require('node:crypto');
const { toIsoTimestamp, toMySqlTimestamp } = require('../users/mysql-user-store');
const { normalizeRequirement, normalizeInteraction, normalizeRequirementQuery } = require('./requirement-input');

function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function validId(value, code) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw failure(code, 'identifier is invalid'); return value; }
function timestamp(clock) { const value = clock(); if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError('clock returned an invalid ISO timestamp'); return toMySqlTimestamp(value); }
function date(value) { return toIsoTimestamp(value); }
function unit(row) { return row && ({ id: row.id, name: row.name, status: row.status, createdByUserId: row.created_by_user_id, createdAt: date(row.created_at), updatedAt: date(row.updated_at) }); }
function interaction(row) { return row && ({ id: row.id, requirementId: row.requirement_id, channel: row.channel, content: row.content, occurredAt: date(row.occurred_at), recordedAt: date(row.recorded_at) }); }
function link(row) { return row && ({ id: row.id, requirementId: row.requirement_id, resourceType: row.resource_type, resourceId: row.resource_id, versionId: row.version_id, title: row.title, createdAt: date(row.created_at) }); }
function summary(row) { return row && ({ id: row.id, ownerUserId: row.owner_user_id, responsibleUserId: row.responsible_user_id, buId: row.bu_id, buName: row.bu_name, title: row.title, scenario: row.scenario, description: row.description, status: row.status, createdAt: date(row.created_at), updatedAt: date(row.updated_at) }); }

function createMySqlRequirementStore(db, { idFactory = crypto.randomUUID, clock = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.query !== 'function' || typeof db.one !== 'function' || typeof db.many !== 'function' || typeof db.transaction !== 'function') throw new TypeError('MySQL requirement database is required');
  async function owned(id, ownerUserId, executor = db) {
    const row = await executor.one(`SELECT r.*, b.name AS bu_name FROM requirements r JOIN business_units b ON b.id = r.bu_id WHERE r.id = ? AND r.owner_user_id = ?`, [validId(id, 'INVALID_REQUIREMENT_ID'), validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR')]);
    if (!row) throw failure('REQUIREMENT_NOT_FOUND', 'requirement was not found'); return row;
  }
  function admin({ actorUserId, actorRole } = {}) { if (actorRole !== 'admin') throw failure('BUSINESS_UNIT_NOT_FOUND', 'business unit was not found'); return validId(actorUserId, 'INVALID_REQUIREMENT_ACTOR'); }
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
  async function createRequirement({ ownerUserId, ...body } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const input = normalizeRequirement(body);
    const id = validId(idFactory(), 'INVALID_REQUIREMENT_ID'); const time = timestamp(clock);
    await db.transaction(async (tx) => {
      await activeUnit(input.buId, tx, { lock: true });
      await tx.query('INSERT INTO requirements (id, owner_user_id, responsible_user_id, bu_id, title, scenario, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, owner, owner, input.buId, input.title, input.scenario, input.description, input.status, time, time]);
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
  async function getRequirement({ ownerUserId, id } = {}) { const item = summary(await owned(id, ownerUserId)); return { ...item, interactions: (await db.many('SELECT * FROM requirement_interactions WHERE requirement_id = ? ORDER BY occurred_at DESC, id DESC', [item.id])).map(interaction), links: await linksFor(item.id) }; }
  async function updateRequirement({ ownerUserId, id, ...body } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const existing = await owned(id, owner); const input = normalizeRequirement(body, { patch: true }); if (input.buId) await activeUnit(input.buId);
    const fields = Object.keys(input); const values = fields.map((key) => input[key]);
    await db.query(`UPDATE requirements SET ${fields.map((key) => `${key === 'buId' ? 'bu_id' : key} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND owner_user_id = ?`, [...values, timestamp(clock), existing.id, owner]);
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
  return Object.freeze({ createBusinessUnit, listBusinessUnits, archiveBusinessUnit, createRequirement, getRequirement, updateRequirement, addInteraction, addRequirementLink, removeRequirementLink, listRequirements });
}

module.exports = { createMySqlRequirementStore };
