'use strict';

const crypto = require('node:crypto');

const SKILL_STATUSES = new Set(['draft', 'published', 'disabled', 'archived']);

function skillError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredText(value, code, message, { max, allowLineBreaks = false } = {}) {
  if (typeof value !== 'string') throw skillError(code, message);
  const normalized = value.trim();
  const unsafe = allowLineBreaks
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  if (!normalized || Array.from(normalized).length > max || unsafe.test(normalized)) {
    throw skillError(code, message);
  }
  return normalized;
}

function descriptionText(value = '') {
  if (typeof value !== 'string' || Array.from(value.trim()).length > 500 ||
      /[\u0000-\u001f\u007f]/.test(value.trim())) {
    throw skillError('INVALID_SKILL_DESCRIPTION', 'skill description is invalid');
  }
  return value.trim();
}

function sourceText(value) {
  const source = requiredText(
    value,
    'INVALID_SKILL_SOURCE',
    'skill source is invalid',
    { max: 262144, allowLineBreaks: true }
  );
  if (Buffer.byteLength(source, 'utf8') > 262144) {
    throw skillError('INVALID_SKILL_SOURCE', 'skill source is invalid');
  }
  return source;
}

function normalizeSlug(value) {
  if (typeof value !== 'string') {
    throw skillError('INVALID_SKILL_SLUG', 'skill slug is invalid');
  }
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || slug.length > 64) {
    throw skillError('INVALID_SKILL_SLUG', 'skill slug is invalid');
  }
  return slug;
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object' ||
      typeof actor.id !== 'string' || !actor.id ||
      !['admin', 'member'].includes(actor.role)) {
    throw skillError('INVALID_SKILL_ACTOR', 'skill actor is invalid');
  }
  return { id: actor.id, role: actor.role };
}

function normalizeId(value, code = 'INVALID_SKILL_ID') {
  return requiredText(value, code, 'skill id is invalid', { max: 200 });
}

function parseReport(value) {
  try { return JSON.parse(value); } catch { return {}; }
}

function toSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    version: row.version,
    versionStatus: row.version_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toDetail(row) {
  const skill = toSummary(row);
  if (!skill) return null;
  return {
    ...skill,
    version: {
      id: row.version_id,
      version: row.version,
      status: row.version_status,
      skillMd: row.skill_md,
      validationReport: parseReport(row.validation_report_json),
      contentSha256: row.content_sha256,
      createdAt: row.version_created_at,
      updatedAt: row.version_updated_at,
      publishedAt: row.published_at
    }
  };
}

function createSkillStore(db, {
  idFactory = crypto.randomUUID,
  clock = () => new Date().toISOString()
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('skill database is required');
  if (typeof idFactory !== 'function' || typeof clock !== 'function') {
    throw new TypeError('skill store dependencies are invalid');
  }

  const detailSql = `
    SELECT s.*, v.id AS version_id, v.version, v.status AS version_status,
      v.skill_md, v.validation_report_json, v.content_sha256,
      v.created_at AS version_created_at, v.updated_at AS version_updated_at,
      v.published_at
    FROM skills s
    JOIN skill_versions v ON v.skill_id = s.id
    WHERE s.id = ?
    ORDER BY v.created_at DESC, v.id DESC
    LIMIT 1
  `;
  const byId = db.prepare(detailSql);
  const bySlug = db.prepare('SELECT id FROM skills WHERE slug = ? COLLATE NOCASE');

  function transaction(action) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const result = action();
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  function visibleRow({ actor, id }) {
    const normalizedActor = normalizeActor(actor);
    const row = byId.get(normalizeId(id));
    if (!row) return null;
    if (normalizedActor.role === 'admin' || row.owner_user_id === normalizedActor.id ||
        (row.visibility === 'team' && ['published', 'disabled'].includes(row.status))) return row;
    return null;
  }

  function editableRow({ actor, id }) {
    const row = visibleRow({ actor, id });
    if (!row || (actor.role !== 'admin' && row.owner_user_id !== actor.id)) {
      throw skillError('SKILL_NOT_FOUND', 'skill was not found');
    }
    return row;
  }

  function createDraft({ actor, slug, displayName, description = '', skillMd }) {
    const normalizedActor = normalizeActor(actor);
    const normalizedSlug = normalizeSlug(slug);
    const normalizedDisplayName = requiredText(
      displayName,
      'INVALID_SKILL_DISPLAY_NAME',
      'skill display name is invalid',
      { max: 100 }
    );
    const normalizedDescription = descriptionText(description);
    const normalizedSource = sourceText(skillMd);
    if (bySlug.get(normalizedSlug)) {
      throw skillError('SKILL_SLUG_CONFLICT', 'skill slug already exists');
    }
    const skillId = normalizeId(idFactory());
    const versionId = normalizeId(idFactory(), 'INVALID_SKILL_VERSION_ID');
    const now = requiredText(clock(), 'INVALID_SKILL_TIMESTAMP', 'skill timestamp is invalid', { max: 100 });
    const digest = crypto.createHash('sha256').update(normalizedSource).digest('hex');

    try {
      transaction(() => {
        db.prepare(`
          INSERT INTO skills (
            id, owner_user_id, slug, display_name, description, status, visibility,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'draft', 'private', ?, ?)
        `).run(
          skillId, normalizedActor.id, normalizedSlug, normalizedDisplayName,
          normalizedDescription, now, now
        );
        db.prepare(`
          INSERT INTO skill_versions (
            id, skill_id, version, status, skill_md, validation_report_json,
            content_sha256, created_by_user_id, created_at, updated_at
          ) VALUES (?, ?, '0.1.0', 'draft', ?, '{}', ?, ?, ?, ?)
        `).run(versionId, skillId, normalizedSource, digest, normalizedActor.id, now, now);
      });
    } catch (error) {
      if (/skills\.slug|UNIQUE constraint failed: skills\.slug/.test(error.message)) {
        throw skillError('SKILL_SLUG_CONFLICT', 'skill slug already exists');
      }
      if (/FOREIGN KEY constraint failed/.test(error.message)) {
        throw skillError('SKILL_OWNER_NOT_FOUND', 'skill owner was not found');
      }
      throw error;
    }
    return toDetail(byId.get(skillId));
  }

  function listVisible({ actor, status = 'draft', limit = 100, offset = 0 } = {}) {
    const normalizedActor = normalizeActor(actor);
    if (status !== 'all' && !SKILL_STATUSES.has(status)) {
      throw skillError('INVALID_SKILL_STATUS', 'skill status is invalid');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 ||
        !Number.isInteger(offset) || offset < 0) {
      throw skillError('INVALID_SKILL_PAGE', 'skill page is invalid');
    }
    const rows = db.prepare(`
      SELECT s.*, v.version, v.status AS version_status
      FROM skills s
      JOIN skill_versions v ON v.id = (
        SELECT latest.id
        FROM skill_versions latest
        WHERE latest.skill_id = s.id
        ORDER BY latest.created_at DESC, latest.id DESC
        LIMIT 1
      )
      WHERE (? = 'all' OR s.status = ?)
        AND (
          ? = 'admin'
          OR s.owner_user_id = ?
          OR (s.visibility = 'team' AND s.status IN ('published', 'disabled'))
        )
      ORDER BY s.updated_at DESC, s.id DESC
      LIMIT ? OFFSET ?
    `).all(status, status, normalizedActor.role, normalizedActor.id, limit, offset);
    return rows.map(toSummary);
  }

  function getVisible({ actor, id }) {
    return toDetail(visibleRow({ actor, id }));
  }

  function updateDraft({ actor, id, displayName, description, skillMd }) {
    const row = editableRow({ actor, id });
    if (row.status !== 'draft' || row.version_status !== 'draft') {
      throw skillError('SKILL_NOT_EDITABLE', 'skill draft cannot be changed');
    }
    if (displayName === undefined && description === undefined && skillMd === undefined) {
      throw skillError('INVALID_SKILL_UPDATE', 'skill update is empty');
    }
    const nextDisplayName = displayName === undefined
      ? row.display_name
      : requiredText(
        displayName,
        'INVALID_SKILL_DISPLAY_NAME',
        'skill display name is invalid',
        { max: 100 }
      );
    const nextDescription = description === undefined ? row.description : descriptionText(description);
    const nextSource = skillMd === undefined ? row.skill_md : sourceText(skillMd);
    const digest = crypto.createHash('sha256').update(nextSource).digest('hex');
    const now = requiredText(clock(), 'INVALID_SKILL_TIMESTAMP', 'skill timestamp is invalid', { max: 100 });

    transaction(() => {
      db.prepare(`
        UPDATE skills SET display_name = ?, description = ?, updated_at = ? WHERE id = ?
      `).run(nextDisplayName, nextDescription, now, row.id);
      db.prepare(`
        UPDATE skill_versions
        SET skill_md = ?, status = 'draft', validation_report_json = '{}',
          content_sha256 = ?, updated_at = ?
        WHERE id = ?
      `).run(nextSource, digest, now, row.version_id);
    });
    return toDetail(byId.get(row.id));
  }

  function archiveDraft({ actor, id }) {
    const row = editableRow({ actor, id });
    if (row.status === 'archived') return toDetail(row);
    if (row.status !== 'draft') {
      throw skillError('SKILL_NOT_ARCHIVABLE', 'skill cannot be archived from its current status');
    }
    db.prepare(`UPDATE skills SET status = 'archived', updated_at = ? WHERE id = ?`)
      .run(requiredText(clock(), 'INVALID_SKILL_TIMESTAMP', 'skill timestamp is invalid', { max: 100 }), row.id);
    return toDetail(byId.get(row.id));
  }

  return { archiveDraft, createDraft, getVisible, listVisible, updateDraft };
}

module.exports = { createSkillStore };
