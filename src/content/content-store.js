'use strict';

const crypto = require('node:crypto');

const CONTENT_STATUSES = new Set(['draft', 'published', 'withdrawn', 'archived']);
const CONTENT_VISIBILITIES = new Set(['private', 'team']);
const REFERENCE_TYPES = new Set(['conversation', 'knowledge_version', 'skill_version', 'model']);

function contentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredText(value, code, { max, allowEmpty = false, multiline = false } = {}) {
  if (typeof value !== 'string') throw contentError(code, 'content input is invalid');
  const normalized = value.trim();
  const unsafe = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if ((!allowEmpty && !normalized) || Array.from(normalized).length > max || unsafe.test(normalized)) {
    throw contentError(code, 'content input is invalid');
  }
  return normalized;
}

function optionalText(value, code, options) {
  return value === undefined ? undefined : requiredText(value, code, options);
}

function normalizeActor({ actorUserId, actorRole = 'member' } = {}) {
  const id = requiredText(actorUserId, 'INVALID_CONTENT_ACTOR', { max: 200 });
  if (!['member', 'admin'].includes(actorRole)) {
    throw contentError('INVALID_CONTENT_ACTOR', 'content actor is invalid');
  }
  return { id, role: actorRole };
}

function normalizeVisibility(value = 'private') {
  if (!CONTENT_VISIBILITIES.has(value)) throw contentError('INVALID_CONTENT_VISIBILITY', 'content visibility is invalid');
  return value;
}

function normalizeStatus(value = 'draft') {
  if (!CONTENT_STATUSES.has(value)) throw contentError('INVALID_CONTENT_STATUS', 'content status is invalid');
  return value;
}

function normalizeTags(value = []) {
  if (!Array.isArray(value) || value.length > 20) throw contentError('INVALID_CONTENT_TAGS', 'content tags are invalid');
  const normalized = [...new Set(value.map((item) => requiredText(item, 'INVALID_CONTENT_TAGS', { max: 64 })))]
    .sort((a, b) => a.localeCompare(b));
  return normalized;
}

function parseTags(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeReferences(value = []) {
  if (!Array.isArray(value) || value.length > 100) {
    throw contentError('INVALID_CONTENT_REFERENCES', 'content references are invalid');
  }
  const seen = new Set();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || !REFERENCE_TYPES.has(item.sourceType)) {
      throw contentError('INVALID_CONTENT_REFERENCES', 'content references are invalid');
    }
    const sourceId = requiredText(item.sourceId, 'INVALID_CONTENT_REFERENCES', { max: 200 });
    const key = `${item.sourceType}\u0000${sourceId}`;
    if (seen.has(key)) throw contentError('INVALID_CONTENT_REFERENCES', 'content references are invalid');
    seen.add(key);
    return { sourceType: item.sourceType, sourceId };
  });
}

function canRead(actor, row) {
  return actor.role === 'admin' || row.owner_user_id === actor.id ||
    (row.visibility === 'team' && row.status === 'published');
}

function toKnowledgeSummary(row) {
  return {
    id: row.document_id,
    ownerUserId: row.owner_user_id,
    status: row.status,
    visibility: row.visibility,
    version: row.version_number,
    title: row.title,
    category: row.category,
    tags: parseTags(row.tags_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSolutionSummary(row) {
  return {
    id: row.solution_id,
    ownerUserId: row.owner_user_id,
    status: row.status,
    visibility: row.visibility,
    version: row.version_number,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toFtsQuery(query) {
  const parts = requiredText(query, 'INVALID_CONTENT_QUERY', { max: 200 })
    .replace(/["'*^:(){}\[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return parts.length ? parts.map((part) => `"${part}"`).join(' AND ') : null;
}

function createContentStore(db, {
  idFactory = crypto.randomUUID,
  clock = () => new Date().toISOString()
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('content database is required');
  if (typeof idFactory !== 'function' || typeof clock !== 'function') {
    throw new TypeError('content store dependencies are invalid');
  }

  const currentKnowledgeById = db.prepare(`
    SELECT d.id AS document_id, d.owner_user_id, d.status, d.visibility, d.created_at, d.updated_at,
      v.id AS version_id, v.version_number, v.title, v.category, v.tags_json, v.markdown
    FROM knowledge_documents d
    JOIN knowledge_versions v ON v.id = d.current_version_id
    WHERE d.id = ?
  `);
  const knowledgeHistory = db.prepare(`
    SELECT id, version_number, title, category, tags_json, created_at, created_by_user_id
    FROM knowledge_versions WHERE document_id = ? ORDER BY version_number DESC
  `);
  const currentSolutionById = db.prepare(`
    SELECT s.id AS solution_id, s.owner_user_id, s.status, s.visibility, s.created_at, s.updated_at,
      v.id AS version_id, v.version_number, v.title, v.description, v.solution_markdown
    FROM solutions s
    JOIN solution_versions v ON v.id = s.current_version_id
    WHERE s.id = ?
  `);
  const solutionHistory = db.prepare(`
    SELECT id, version_number, title, created_at, created_by_user_id
    FROM solution_versions WHERE solution_id = ? ORDER BY version_number DESC
  `);
  const referencesByVersion = db.prepare(`
    SELECT source_type, source_id FROM content_references
    WHERE solution_version_id = ? ORDER BY source_type, source_id
  `);

  function now() {
    const value = clock();
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      throw new TypeError('clock returned an invalid ISO timestamp');
    }
    return value;
  }

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

  function readableKnowledge(actor, documentId) {
    const row = currentKnowledgeById.get(requiredText(documentId, 'INVALID_CONTENT_ID', { max: 200 }));
    if (!row || !canRead(actor, row)) throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    return row;
  }

  function writableKnowledge(actor, documentId) {
    const row = readableKnowledge(actor, documentId);
    if (actor.role !== 'admin' && row.owner_user_id !== actor.id) {
      throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    }
    return row;
  }

  function readableSolution(actor, solutionId) {
    const row = currentSolutionById.get(requiredText(solutionId, 'INVALID_CONTENT_ID', { max: 200 }));
    if (!row || !canRead(actor, row)) throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    return row;
  }

  function writableSolution(actor, solutionId) {
    const row = readableSolution(actor, solutionId);
    if (actor.role !== 'admin' && row.owner_user_id !== actor.id) {
      throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    }
    return row;
  }

  function replaceFts(row) {
    db.prepare('DELETE FROM knowledge_fts WHERE document_id = ?').run(row.document_id);
    db.prepare(`
      INSERT INTO knowledge_fts (document_id, version_id, title, category, tags, markdown)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.document_id, row.version_id, row.title, row.category, parseTags(row.tags_json).join(' '), row.markdown);
  }

  function insertReferences({ solutionVersionId, references, timestamp }) {
    const insert = db.prepare(`
      INSERT INTO content_references (id, source_type, source_id, knowledge_version_id, solution_version_id, created_at)
      VALUES (?, ?, ?, NULL, ?, ?)
    `);
    for (const reference of references) {
      insert.run(idFactory(), reference.sourceType, reference.sourceId, solutionVersionId, timestamp);
    }
  }

  function createKnowledgeDraft({ actorUserId, actorRole, title, category = '', tags = [], markdown, visibility = 'private', status = 'draft' }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const timestamp = now();
    const documentId = idFactory();
    const versionId = idFactory();
    const fields = {
      title: requiredText(title, 'INVALID_KNOWLEDGE_TITLE', { max: 200 }),
      category: requiredText(category, 'INVALID_KNOWLEDGE_CATEGORY', { max: 100, allowEmpty: true }),
      tags: normalizeTags(tags),
      markdown: requiredText(markdown, 'INVALID_KNOWLEDGE_MARKDOWN', { max: 1048576, multiline: true }),
      visibility: normalizeVisibility(visibility),
      status: normalizeStatus(status)
    };
    return transaction(() => {
      db.prepare(`
        INSERT INTO knowledge_documents (id, owner_user_id, status, visibility, current_version_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?)
      `).run(documentId, actor.id, fields.status, fields.visibility, timestamp, timestamp);
      db.prepare(`
        INSERT INTO knowledge_versions (
          id, document_id, version_number, title, category, tags_json, markdown, is_current, created_at, created_by_user_id
        ) VALUES (?, ?, 1, ?, ?, ?, ?, 1, ?, ?)
      `).run(versionId, documentId, fields.title, fields.category, JSON.stringify(fields.tags), fields.markdown, timestamp, actor.id);
      db.prepare('UPDATE knowledge_documents SET current_version_id = ? WHERE id = ?').run(versionId, documentId);
      const row = currentKnowledgeById.get(documentId);
      replaceFts(row);
      return toKnowledgeSummary(row);
    });
  }

  function saveKnowledgeVersion({ actorUserId, actorRole, documentId, title, category, tags, markdown, visibility, status }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const timestamp = now();
    return transaction(() => {
      const existing = writableKnowledge(actor, documentId);
      const versionId = idFactory();
      const next = {
        title: optionalText(title, 'INVALID_KNOWLEDGE_TITLE', { max: 200 }) ?? existing.title,
        category: optionalText(category, 'INVALID_KNOWLEDGE_CATEGORY', { max: 100, allowEmpty: true }) ?? existing.category,
        tags: tags === undefined ? parseTags(existing.tags_json) : normalizeTags(tags),
        markdown: optionalText(markdown, 'INVALID_KNOWLEDGE_MARKDOWN', { max: 1048576, multiline: true }) ?? existing.markdown,
        visibility: visibility === undefined ? existing.visibility : normalizeVisibility(visibility),
        status: status === undefined ? existing.status : normalizeStatus(status)
      };
      db.prepare('UPDATE knowledge_versions SET is_current = 0 WHERE id = ?').run(existing.version_id);
      db.prepare(`
        INSERT INTO knowledge_versions (
          id, document_id, version_number, title, category, tags_json, markdown, is_current, created_at, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(versionId, existing.document_id, existing.version_number + 1, next.title, next.category,
        JSON.stringify(next.tags), next.markdown, timestamp, actor.id);
      db.prepare(`
        UPDATE knowledge_documents SET current_version_id = ?, visibility = ?, status = ?, updated_at = ? WHERE id = ?
      `).run(versionId, next.visibility, next.status, timestamp, existing.document_id);
      const row = currentKnowledgeById.get(existing.document_id);
      replaceFts(row);
      return toKnowledgeSummary(row);
    });
  }

  function getKnowledge({ actorUserId, actorRole, documentId, includeContent = false }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const row = readableKnowledge(actor, documentId);
    const summary = toKnowledgeSummary(row);
    return {
      ...summary,
      ...(includeContent ? { markdown: row.markdown } : {}),
      versionHistory: knowledgeHistory.all(row.document_id).map((version) => ({
        id: version.id,
        version: version.version_number,
        title: version.title,
        category: version.category,
        tags: parseTags(version.tags_json),
        createdAt: version.created_at,
        createdByUserId: version.created_by_user_id
      }))
    };
  }

  function searchKnowledge({ actorUserId, actorRole, query, limit = 20 }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const ftsQuery = toFtsQuery(query);
    const normalizedLimit = Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : 20;
    if (!ftsQuery) return [];
    const rows = db.prepare(`
      SELECT d.id AS document_id, d.owner_user_id, d.status, d.visibility, d.created_at, d.updated_at,
        v.version_number, v.title, v.category, v.tags_json,
        snippet(knowledge_fts, 5, '', '', '…', 18) AS preview
      FROM knowledge_fts
      JOIN knowledge_documents d ON d.id = knowledge_fts.document_id
      JOIN knowledge_versions v ON v.id = knowledge_fts.version_id AND v.id = d.current_version_id
      WHERE knowledge_fts MATCH ? AND (
        d.owner_user_id = ? OR (d.visibility = 'team' AND d.status = 'published') OR ? = 'admin'
      )
      ORDER BY bm25(knowledge_fts), d.updated_at DESC
      LIMIT ?
    `).all(ftsQuery, actor.id, actor.role, normalizedLimit);
    return rows.map((row) => ({ ...toKnowledgeSummary(row), preview: row.preview }));
  }

  function createSolutionDraft({ actorUserId, actorRole, title, description = '', solutionMarkdown = '', references = [], visibility = 'private', status = 'draft' }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const timestamp = now();
    const solutionId = idFactory();
    const versionId = idFactory();
    const fields = {
      title: requiredText(title, 'INVALID_SOLUTION_TITLE', { max: 200 }),
      description: requiredText(description, 'INVALID_SOLUTION_DESCRIPTION', { max: 10000, allowEmpty: true, multiline: true }),
      solutionMarkdown: requiredText(solutionMarkdown, 'INVALID_SOLUTION_MARKDOWN', { max: 1048576, allowEmpty: true, multiline: true }),
      references: normalizeReferences(references),
      visibility: normalizeVisibility(visibility),
      status: normalizeStatus(status)
    };
    return transaction(() => {
      db.prepare(`
        INSERT INTO solutions (id, owner_user_id, status, visibility, current_version_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?)
      `).run(solutionId, actor.id, fields.status, fields.visibility, timestamp, timestamp);
      db.prepare(`
        INSERT INTO solution_versions (
          id, solution_id, version_number, title, description, solution_markdown, is_current, created_at, created_by_user_id
        ) VALUES (?, ?, 1, ?, ?, ?, 1, ?, ?)
      `).run(versionId, solutionId, fields.title, fields.description, fields.solutionMarkdown, timestamp, actor.id);
      insertReferences({ solutionVersionId: versionId, references: fields.references, timestamp });
      db.prepare('UPDATE solutions SET current_version_id = ? WHERE id = ?').run(versionId, solutionId);
      return toSolutionSummary(currentSolutionById.get(solutionId));
    });
  }

  function saveSolutionVersion({ actorUserId, actorRole, solutionId, title, description, solutionMarkdown, references, visibility, status }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const timestamp = now();
    return transaction(() => {
      const existing = writableSolution(actor, solutionId);
      const versionId = idFactory();
      const next = {
        title: optionalText(title, 'INVALID_SOLUTION_TITLE', { max: 200 }) ?? existing.title,
        description: optionalText(description, 'INVALID_SOLUTION_DESCRIPTION', { max: 10000, allowEmpty: true, multiline: true }) ?? existing.description,
        solutionMarkdown: optionalText(solutionMarkdown, 'INVALID_SOLUTION_MARKDOWN', { max: 1048576, allowEmpty: true, multiline: true }) ?? existing.solution_markdown,
        references: references === undefined
          ? referencesByVersion.all(existing.version_id).map((item) => ({ sourceType: item.source_type, sourceId: item.source_id }))
          : normalizeReferences(references),
        visibility: visibility === undefined ? existing.visibility : normalizeVisibility(visibility),
        status: status === undefined ? existing.status : normalizeStatus(status)
      };
      db.prepare('UPDATE solution_versions SET is_current = 0 WHERE id = ?').run(existing.version_id);
      db.prepare(`
        INSERT INTO solution_versions (
          id, solution_id, version_number, title, description, solution_markdown, is_current, created_at, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(versionId, existing.solution_id, existing.version_number + 1, next.title, next.description,
        next.solutionMarkdown, timestamp, actor.id);
      insertReferences({ solutionVersionId: versionId, references: next.references, timestamp });
      db.prepare(`
        UPDATE solutions SET current_version_id = ?, visibility = ?, status = ?, updated_at = ? WHERE id = ?
      `).run(versionId, next.visibility, next.status, timestamp, existing.solution_id);
      return toSolutionSummary(currentSolutionById.get(existing.solution_id));
    });
  }

  function getSolution({ actorUserId, actorRole, solutionId, includeContent = false }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const row = readableSolution(actor, solutionId);
    const summary = toSolutionSummary(row);
    return {
      ...summary,
      ...(includeContent ? { description: row.description, solutionMarkdown: row.solution_markdown } : {}),
      references: referencesByVersion.all(row.version_id).map((item) => ({
        sourceType: item.source_type,
        sourceId: item.source_id
      })),
      versionHistory: solutionHistory.all(row.solution_id).map((version) => ({
        id: version.id,
        version: version.version_number,
        title: version.title,
        createdAt: version.created_at,
        createdByUserId: version.created_by_user_id
      }))
    };
  }

  function listSolutions({ actorUserId, actorRole }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const rows = db.prepare(`
      SELECT s.id AS solution_id, s.owner_user_id, s.status, s.visibility, s.created_at, s.updated_at,
        v.version_number, v.title
      FROM solutions s JOIN solution_versions v ON v.id = s.current_version_id
      WHERE s.owner_user_id = ? OR (s.visibility = 'team' AND s.status = 'published') OR ? = 'admin'
      ORDER BY s.updated_at DESC, s.id DESC
    `).all(actor.id, actor.role);
    return rows.map(toSolutionSummary);
  }

  return {
    createKnowledgeDraft,
    saveKnowledgeVersion,
    getKnowledge,
    searchKnowledge,
    createSolutionDraft,
    saveSolutionVersion,
    getSolution,
    listSolutions
  };
}

module.exports = { createContentStore };
