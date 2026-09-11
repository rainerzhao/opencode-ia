'use strict';

const crypto = require('node:crypto');

const CONTENT_STATUSES = new Set(['draft', 'published', 'withdrawn', 'archived']);
const CONTENT_VISIBILITIES = new Set(['private', 'team']);
const REFERENCE_TYPES = new Set(['conversation', 'knowledge_version', 'solution_version', 'skill_version', 'model']);

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

function normalizeVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1 || version > 100000) {
    throw contentError('INVALID_CONTENT_VERSION', 'content version is invalid');
  }
  return version;
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
  const knowledgeVersionByNumber = db.prepare(`
    SELECT d.id AS document_id, d.owner_user_id, d.status, d.visibility,
      v.id AS version_id, v.version_number, v.title, v.category, v.tags_json, v.markdown, v.created_at, v.created_by_user_id
    FROM knowledge_documents d JOIN knowledge_versions v ON v.document_id = d.id
    WHERE d.id = ? AND v.version_number = ?
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
    SELECT r.source_type, r.source_id,
      d.conversation_id, d.first_sequence, d.last_sequence,
      d.completed_turn_count, d.content_sha256, d.created_at AS reference_created_at
    FROM content_references r
    LEFT JOIN conversation_reference_details d ON d.content_reference_id = r.id
    WHERE r.solution_version_id = ? ORDER BY r.source_type, r.source_id
  `);
  const knowledgeReferencesByVersion = db.prepare(`
    SELECT source_type, source_id, created_at
    FROM content_references
    WHERE knowledge_version_id = ? ORDER BY source_type, source_id
  `);
  const attachmentsByKnowledgeVersion = db.prepare(`
    SELECT id, original_name, media_type, size_bytes, content_sha256, storage_key, created_at
    FROM content_attachments WHERE knowledge_version_id = ? ORDER BY created_at, id
  `);
  const attachmentByKnowledgeVersion = db.prepare(`
    SELECT a.id, a.original_name, a.media_type, a.size_bytes, a.content_sha256, a.storage_key, a.created_at
    FROM content_attachments a WHERE a.id = ? AND a.knowledge_version_id = ?
  `);
  const conversationByOwner = db.prepare(`
    SELECT id FROM conversations WHERE id = ? AND owner_user_id = ?
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
      const referenceId = idFactory();
      insert.run(referenceId, reference.sourceType, reference.sourceId, solutionVersionId, timestamp);
      if (reference.sourceType === 'conversation' && reference.firstSequence !== undefined) {
        db.prepare(`INSERT INTO conversation_reference_details (
          content_reference_id, conversation_id, first_sequence, last_sequence,
          completed_turn_count, content_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(referenceId, reference.conversationId || reference.sourceId, reference.firstSequence,
            reference.lastSequence, reference.completedTurnCount, reference.contentSha256, timestamp);
      }
    }
  }

  function normalizeConversationSource({ actor, conversationId, assistantMarkdown, firstSequence, lastSequence, completedTurnCount, contentSha256 }) {
    const conversation = requiredText(conversationId, 'INVALID_CONTENT_SOURCE', { max: 200 });
    if (!conversationByOwner.get(conversation, actor.id)) {
      throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    }
    const markdown = requiredText(assistantMarkdown, 'INVALID_CONTENT_SOURCE', {
      max: 1048576,
      multiline: true
    });
    if (!Number.isInteger(firstSequence) || firstSequence < 1 ||
      !Number.isInteger(lastSequence) || lastSequence < firstSequence ||
      !Number.isInteger(completedTurnCount) || completedTurnCount < 1 ||
      typeof contentSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(contentSha256) ||
      crypto.createHash('sha256').update(markdown).digest('hex') !== contentSha256.toLowerCase()) {
      throw contentError('INVALID_CONTENT_SOURCE', 'conversation source is invalid');
    }
    return {
      conversationId: conversation,
      assistantMarkdown: markdown,
      firstSequence,
      lastSequence,
      completedTurnCount,
      contentSha256: contentSha256.toLowerCase()
    };
  }

  function toReferenceCard(item, { ownerUserId, actor }) {
    if (!item.conversation_id) return { sourceType: item.source_type, sourceId: item.source_id };
    if (ownerUserId === actor.id) {
      return {
        sourceType: item.source_type,
        sourceId: item.source_id,
        firstSequence: item.first_sequence,
        lastSequence: item.last_sequence,
        completedTurnCount: item.completed_turn_count,
        contentSha256: item.content_sha256
      };
    }
    return {
      sourceType: 'conversation',
      completedTurnCount: item.completed_turn_count,
      createdAt: item.reference_created_at,
      private: true
    };
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
      references: knowledgeReferencesByVersion.all(row.version_id).map((item) => ({
        sourceType: item.source_type,
        sourceId: item.source_id,
        createdAt: item.created_at
      })),
      attachments: attachmentsByKnowledgeVersion.all(row.version_id).map((item) => ({
        id: item.id, originalName: item.original_name, mediaType: item.media_type,
        sizeBytes: item.size_bytes, contentSha256: item.content_sha256, createdAt: item.created_at
      })),
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

  function getKnowledgeVersion({ actorUserId, actorRole, documentId, version }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const current = readableKnowledge(actor, documentId);
    const requestedVersion = normalizeVersion(version);
    if (actor.role !== 'admin' && current.owner_user_id !== actor.id && requestedVersion !== current.version_number) {
      throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    }
    const row = knowledgeVersionByNumber.get(current.document_id, requestedVersion);
    if (!row) throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    return {
      id: row.version_id, documentId: row.document_id, version: row.version_number,
      title: row.title, category: row.category, tags: parseTags(row.tags_json), markdown: row.markdown,
      createdAt: row.created_at, createdByUserId: row.created_by_user_id
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

  function listKnowledge({ actorUserId, actorRole }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const rows = db.prepare(`
      SELECT d.id AS document_id, d.owner_user_id, d.status, d.visibility, d.created_at, d.updated_at,
        v.version_number, v.title, v.category, v.tags_json
      FROM knowledge_documents d
      JOIN knowledge_versions v ON v.id = d.current_version_id
      WHERE d.owner_user_id = ? OR (d.visibility = 'team' AND d.status = 'published') OR ? = 'admin'
      ORDER BY d.updated_at DESC, d.id DESC
    `).all(actor.id, actor.role);
    return rows.map(toKnowledgeSummary);
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

  function createSolutionFromConversation({ actorUserId, actorRole, conversationId, title, description = '', assistantMarkdown, firstSequence, lastSequence, completedTurnCount, contentSha256 }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const source = normalizeConversationSource({
      actor, conversationId, assistantMarkdown, firstSequence, lastSequence, completedTurnCount, contentSha256
    });
    const timestamp = now();
    const solutionId = idFactory();
    const versionId = idFactory();
    const referenceId = idFactory();
    const fields = {
      title: requiredText(title, 'INVALID_SOLUTION_TITLE', { max: 200 }),
      description: requiredText(description, 'INVALID_SOLUTION_DESCRIPTION', { max: 10000, allowEmpty: true, multiline: true }),
      visibility: 'private',
      status: 'draft'
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
      `).run(versionId, solutionId, fields.title, fields.description, source.assistantMarkdown, timestamp, actor.id);
      db.prepare(`
        INSERT INTO content_references (
          id, source_type, source_id, knowledge_version_id, solution_version_id, created_at
        ) VALUES (?, 'conversation', ?, NULL, ?, ?)
      `).run(referenceId, source.conversationId, versionId, timestamp);
      db.prepare(`
        INSERT INTO conversation_reference_details (
          content_reference_id, conversation_id, first_sequence, last_sequence,
          completed_turn_count, content_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(referenceId, source.conversationId, source.firstSequence, source.lastSequence,
        source.completedTurnCount, source.contentSha256, timestamp);
      db.prepare('UPDATE solutions SET current_version_id = ? WHERE id = ?').run(versionId, solutionId);
      return toSolutionSummary(currentSolutionById.get(solutionId));
    });
  }

  function createKnowledgeFromSolution({ actorUserId, actorRole, solutionId, title, category = '', tags = [], markdown }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const timestamp = now();
    const documentId = idFactory();
    const versionId = idFactory();
    const referenceId = idFactory();
    return transaction(() => {
      const source = writableSolution(actor, solutionId);
      const fields = {
        title: title === undefined ? source.title : requiredText(title, 'INVALID_KNOWLEDGE_TITLE', { max: 200 }),
        category: requiredText(category, 'INVALID_KNOWLEDGE_CATEGORY', { max: 100, allowEmpty: true }),
        tags: normalizeTags(tags),
        markdown: requiredText(markdown, 'INVALID_KNOWLEDGE_MARKDOWN', { max: 1048576, multiline: true }),
        visibility: 'private',
        status: 'draft'
      };
      db.prepare(`INSERT INTO knowledge_documents (
        id, owner_user_id, status, visibility, current_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?)`).run(documentId, actor.id, fields.status, fields.visibility, timestamp, timestamp);
      db.prepare(`INSERT INTO knowledge_versions (
        id, document_id, version_number, title, category, tags_json, markdown, is_current, created_at, created_by_user_id
      ) VALUES (?, ?, 1, ?, ?, ?, ?, 1, ?, ?)`).run(
        versionId, documentId, fields.title, fields.category, JSON.stringify(fields.tags), fields.markdown, timestamp, actor.id
      );
      db.prepare(`INSERT INTO content_references (
        id, source_type, source_id, knowledge_version_id, solution_version_id, created_at
      ) VALUES (?, 'solution_version', ?, ?, NULL, ?)`).run(referenceId, source.version_id, versionId, timestamp);
      db.prepare('UPDATE knowledge_documents SET current_version_id = ? WHERE id = ?').run(versionId, documentId);
      const row = currentKnowledgeById.get(documentId);
      replaceFts(row);
      return toKnowledgeSummary(row);
    });
  }

  function createKnowledgeAttachment({ actorUserId, actorRole, documentId, id, originalName, mediaType, sizeBytes, contentSha256, storageKey }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const timestamp = now();
    const attachmentId = requiredText(id, 'INVALID_ATTACHMENT', { max: 200 });
    const name = requiredText(originalName, 'INVALID_ATTACHMENT', { max: 200 });
    if (name.includes('/') || name.includes('\\')) throw contentError('INVALID_ATTACHMENT', 'attachment name is invalid');
    const media = requiredText(mediaType, 'INVALID_ATTACHMENT', { max: 200 });
    const size = Number(sizeBytes);
    const digest = typeof contentSha256 === 'string' ? contentSha256.toLowerCase() : '';
    const key = requiredText(storageKey, 'INVALID_ATTACHMENT', { max: 500 });
    if (!Number.isInteger(size) || size < 0 || size > 50 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(digest)) {
      throw contentError('INVALID_ATTACHMENT', 'attachment metadata is invalid');
    }
    return transaction(() => {
      const knowledge = writableKnowledge(actor, documentId);
      try {
        db.prepare(`INSERT INTO content_attachments (
          id, owner_user_id, knowledge_version_id, solution_version_id,
          original_name, media_type, size_bytes, content_sha256, storage_key, created_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`).run(
          attachmentId, actor.id, knowledge.version_id, name, media, size, digest, key, timestamp
        );
      } catch (error) {
        if (/UNIQUE constraint failed/.test(error.message)) throw contentError('ATTACHMENT_CONFLICT', 'attachment already exists');
        throw error;
      }
      return { id: attachmentId, originalName: name, mediaType: media, sizeBytes: size, contentSha256: digest, storageKey: key, createdAt: timestamp };
    });
  }

  function getKnowledgeAttachment({ actorUserId, actorRole, documentId, attachmentId }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const knowledge = readableKnowledge(actor, documentId);
    const attachment = attachmentByKnowledgeVersion.get(requiredText(attachmentId, 'INVALID_ATTACHMENT', { max: 200 }), knowledge.version_id);
    if (!attachment) throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    return { id: attachment.id, originalName: attachment.original_name, mediaType: attachment.media_type,
      sizeBytes: attachment.size_bytes, contentSha256: attachment.content_sha256, storageKey: attachment.storage_key, createdAt: attachment.created_at };
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
          ? referencesByVersion.all(existing.version_id).map((item) => ({
            sourceType: item.source_type, sourceId: item.source_id,
            ...(item.conversation_id ? {
              conversationId: item.conversation_id,
              firstSequence: item.first_sequence,
              lastSequence: item.last_sequence,
              completedTurnCount: item.completed_turn_count,
              contentSha256: item.content_sha256
            } : {})
          }))
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
      references: referencesByVersion.all(row.version_id).map((item) => toReferenceCard(item, { ownerUserId: row.owner_user_id, actor })),
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

  function publishKnowledge({ actorUserId, actorRole, documentId }) {
    return saveKnowledgeVersion({
      actorUserId,
      actorRole,
      documentId,
      status: 'published',
      visibility: 'team'
    });
  }

  function withdrawKnowledge({ actorUserId, actorRole, documentId }) {
    return saveKnowledgeVersion({
      actorUserId,
      actorRole,
      documentId,
      status: 'withdrawn',
      visibility: 'private'
    });
  }

  function publishSolution({ actorUserId, actorRole, solutionId }) {
    return saveSolutionVersion({
      actorUserId,
      actorRole,
      solutionId,
      status: 'published',
      visibility: 'team'
    });
  }

  function withdrawSolution({ actorUserId, actorRole, solutionId }) {
    return saveSolutionVersion({
      actorUserId,
      actorRole,
      solutionId,
      status: 'withdrawn',
      visibility: 'private'
    });
  }

  return {
    createKnowledgeDraft,
    saveKnowledgeVersion,
    getKnowledge,
    getKnowledgeVersion,
    searchKnowledge,
    listKnowledge,
    createSolutionDraft,
    createSolutionFromConversation,
    createKnowledgeFromSolution,
    createKnowledgeAttachment,
    getKnowledgeAttachment,
    saveSolutionVersion,
    getSolution,
    listSolutions,
    publishKnowledge,
    withdrawKnowledge,
    publishSolution,
    withdrawSolution
  };
}

module.exports = { createContentStore };
