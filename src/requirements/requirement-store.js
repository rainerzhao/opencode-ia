'use strict';

const crypto = require('node:crypto');
const { normalizeRequirement, normalizeInteraction, normalizeRequirementQuery } = require('./requirement-input');

function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function validId(value, code) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw failure(code, 'identifier is invalid'); return value; }
function now(clock) { const value = clock(); if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError('clock returned an invalid ISO timestamp'); return value; }
function unit(row) { return row && ({ id: row.id, name: row.name, status: row.status, createdByUserId: row.created_by_user_id, createdAt: row.created_at, updatedAt: row.updated_at }); }
function interaction(row) { return row && ({ id: row.id, requirementId: row.requirement_id, channel: row.channel, content: row.content, occurredAt: row.occurred_at, recordedAt: row.recorded_at }); }
function summary(row) { return row && ({ id: row.id, ownerUserId: row.owner_user_id, responsibleUserId: row.responsible_user_id, buId: row.bu_id, buName: row.bu_name, title: row.title, scenario: row.scenario, description: row.description, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }); }

function createRequirementStore(db, { idFactory = crypto.randomUUID, clock = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('requirement database is required');
  const selectRequirement = db.prepare(`SELECT r.*, b.name AS bu_name FROM requirements r JOIN business_units b ON b.id = r.bu_id WHERE r.id = ? AND r.owner_user_id = ?`);
  const interactions = db.prepare('SELECT * FROM requirement_interactions WHERE requirement_id = ? ORDER BY occurred_at DESC, id DESC');
  const activeUnit = db.prepare("SELECT * FROM business_units WHERE id = ? AND status = 'active'");

  function mustOwn(id, ownerUserId) { const row = selectRequirement.get(validId(id, 'INVALID_REQUIREMENT_ID'), validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR')); if (!row) throw failure('REQUIREMENT_NOT_FOUND', 'requirement was not found'); return row; }
  function mustAdmin(actor) { if (actor?.actorRole !== 'admin') throw failure('BUSINESS_UNIT_NOT_FOUND', 'business unit was not found'); return validId(actor.actorUserId, 'INVALID_REQUIREMENT_ACTOR'); }
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
  function createRequirement({ ownerUserId, ...body } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const input = normalizeRequirement(body);
    const id = validId(idFactory(), 'INVALID_REQUIREMENT_ID'); const time = now(clock);
    transaction(() => {
      if (!activeUnit.get(input.buId)) throw failure('BUSINESS_UNIT_NOT_FOUND', 'business unit was not found');
      db.prepare('INSERT INTO requirements (id, owner_user_id, responsible_user_id, bu_id, title, scenario, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, owner, owner, input.buId, input.title, input.scenario, input.description, input.status, time, time);
    });
    return summary(selectRequirement.get(id, owner));
  }
  function getRequirement({ ownerUserId, id } = {}) { const item = summary(mustOwn(id, ownerUserId)); return { ...item, interactions: interactions.all(item.id).map(interaction) }; }
  function updateRequirement({ ownerUserId, id, ...body } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const existing = mustOwn(id, owner); const input = normalizeRequirement(body, { patch: true });
    if (input.buId && !activeUnit.get(input.buId)) throw failure('BUSINESS_UNIT_NOT_FOUND', 'business unit was not found');
    const fields = Object.keys(input); const values = fields.map((key) => input[key]);
    db.prepare(`UPDATE requirements SET ${fields.map((key) => `${key === 'buId' ? 'bu_id' : key} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND owner_user_id = ?`).run(...values, now(clock), existing.id, owner);
    return summary(selectRequirement.get(existing.id, owner));
  }
  function addInteraction({ ownerUserId, requirementId, ...body } = {}) {
    const owner = validId(ownerUserId, 'INVALID_REQUIREMENT_ACTOR'); const requirement = mustOwn(requirementId, owner); const input = normalizeInteraction(body); const id = validId(idFactory(), 'INVALID_REQUIREMENT_INTERACTION');
    db.prepare('INSERT INTO requirement_interactions (id, requirement_id, owner_user_id, channel, content, occurred_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, requirement.id, owner, input.channel, input.content, input.occurredAt, now(clock));
    return interaction(db.prepare('SELECT * FROM requirement_interactions WHERE id = ?').get(id));
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
  return Object.freeze({ createBusinessUnit, listBusinessUnits, archiveBusinessUnit, createRequirement, getRequirement, updateRequirement, addInteraction, listRequirements });
}

module.exports = { createRequirementStore };
