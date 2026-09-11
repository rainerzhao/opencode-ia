'use strict';

const crypto = require('node:crypto');
const { toIsoTimestamp, toMySqlTimestamp } = require('../users/mysql-user-store');

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
  if (!['member', 'admin'].includes(actorRole)) throw contentError('INVALID_CONTENT_ACTOR', 'content actor is invalid');
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
  return [...new Set(value.map((item) => requiredText(item, 'INVALID_CONTENT_TAGS', { max: 64 })))]
    .sort((left, right) => left.localeCompare(right));
}

function parseTags(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeReferences(value = []) {
  if (!Array.isArray(value) || value.length > 100) throw contentError('INVALID_CONTENT_REFERENCES', 'content references are invalid');
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

function date(value) {
  return toIsoTimestamp(value);
}

function toKnowledgeSummary(row) {
  return {
    id: row.document_id,
    ownerUserId: row.owner_user_id,
    status: row.status,
    visibility: row.visibility,
    version: Number(row.version_number),
    title: row.title,
    category: row.category,
    tags: parseTags(row.tags_json),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at)
  };
}

function toSolutionSummary(row) {
  return {
    id: row.solution_id,
    ownerUserId: row.owner_user_id,
    status: row.status,
    visibility: row.visibility,
    version: Number(row.version_number),
    title: row.title,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at)
  };
}

function toMySqlSearchQuery(query) {
  const parts = requiredText(query, 'INVALID_CONTENT_QUERY', { max: 200 })
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return parts.length ? parts.map((part) => `+${part}`).join(' ') : null;
}

function createMySqlContentStore(db, {
  idFactory = crypto.randomUUID,
  clock = () => new Date().toISOString()
} = {}) {
  if (!db || typeof db.query !== 'function' || typeof db.one !== 'function' || typeof db.many !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('MySQL content database is required');
  }
  if (typeof idFactory !== 'function' || typeof clock !== 'function') throw new TypeError('content store dependencies are invalid');

  const knowledgeSelect = `
    SELECT d.id AS document_id, d.owner_user_id, d.status, d.visibility, d.created_at, d.updated_at,
      v.id AS version_id, v.version_number, v.title, v.category, v.tags_json, v.markdown
    FROM knowledge_documents d
    JOIN knowledge_versions v ON v.id = d.current_version_id
  `;
  const solutionSelect = `
    SELECT s.id AS solution_id, s.owner_user_id, s.status, s.visibility, s.created_at, s.updated_at,
      v.id AS version_id, v.version_number, v.title, v.description, v.solution_markdown
    FROM solutions s
    JOIN solution_versions v ON v.id = s.current_version_id
  `;

  function now() {
    const value = clock();
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError('clock returned an invalid ISO timestamp');
    return toMySqlTimestamp(value);
  }

  async function readableKnowledge(executor, actor, documentId) {
    const id = requiredText(documentId, 'INVALID_CONTENT_ID', { max: 200 });
    const row = await executor.one(`${knowledgeSelect} WHERE d.id = ?`, [id]);
    if (!row || !canRead(actor, row)) throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    return row;
  }

  async function writableKnowledge(executor, actor, documentId) {
    const row = await readableKnowledge(executor, actor, documentId);
    if (actor.role !== 'admin' && row.owner_user_id !== actor.id) throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    return row;
  }

  async function readableSolution(executor, actor, solutionId) {
    const id = requiredText(solutionId, 'INVALID_CONTENT_ID', { max: 200 });
    const row = await executor.one(`${solutionSelect} WHERE s.id = ?`, [id]);
    if (!row || !canRead(actor, row)) throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    return row;
  }

  async function writableSolution(executor, actor, solutionId) {
    const row = await readableSolution(executor, actor, solutionId);
    if (actor.role !== 'admin' && row.owner_user_id !== actor.id) throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    return row;
  }

  async function referencesByVersion(executor, versionId) {
    return (await executor.many(`SELECT r.source_type, r.source_id,
      d.conversation_id, d.first_sequence, d.last_sequence,
      d.completed_turn_count, d.content_sha256, d.created_at AS reference_created_at
      FROM content_references r
      LEFT JOIN conversation_reference_details d ON d.content_reference_id = r.id
      WHERE r.solution_version_id = ? ORDER BY r.source_type, r.source_id`, [versionId]))
      .map((row) => ({
        sourceType: row.source_type,
        sourceId: row.source_id,
        ...(row.conversation_id ? {
          firstSequence: Number(row.first_sequence),
          lastSequence: Number(row.last_sequence),
          completedTurnCount: Number(row.completed_turn_count),
          contentSha256: row.content_sha256
        } : {})
      }));
  }

  async function knowledgeReferencesByVersion(executor, versionId) {
    return (await executor.many(`SELECT source_type, source_id, created_at
      FROM content_references WHERE knowledge_version_id = ? ORDER BY source_type, source_id`, [versionId]))
      .map((row) => ({ sourceType: row.source_type, sourceId: row.source_id, createdAt: date(row.created_at) }));
  }

  async function normalizeConversationSource(executor, { actor, conversationId, assistantMarkdown, firstSequence, lastSequence, completedTurnCount, contentSha256 }) {
    const conversation = requiredText(conversationId, 'INVALID_CONTENT_SOURCE', { max: 200 });
    const owner = await executor.one('SELECT id FROM conversations WHERE id = ? AND owner_user_id = ?', [conversation, actor.id]);
    if (!owner) throw contentError('CONTENT_NOT_FOUND', 'content was not found');
    const markdown = requiredText(assistantMarkdown, 'INVALID_CONTENT_SOURCE', { max: 1048576, multiline: true });
    if (!Number.isInteger(firstSequence) || firstSequence < 1 ||
      !Number.isInteger(lastSequence) || lastSequence < firstSequence ||
      !Number.isInteger(completedTurnCount) || completedTurnCount < 1 ||
      typeof contentSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(contentSha256) ||
      crypto.createHash('sha256').update(markdown).digest('hex') !== contentSha256.toLowerCase()) {
      throw contentError('INVALID_CONTENT_SOURCE', 'conversation source is invalid');
    }
    return { conversationId: conversation, assistantMarkdown: markdown, firstSequence, lastSequence, completedTurnCount, contentSha256: contentSha256.toLowerCase() };
  }

  function toReferenceCard(item, { ownerUserId, actor }) {
    if (!item.conversation_id) return { sourceType: item.source_type, sourceId: item.source_id };
    if (ownerUserId === actor.id) {
      return {
        sourceType: item.source_type,
        sourceId: item.source_id,
        firstSequence: Number(item.first_sequence),
        lastSequence: Number(item.last_sequence),
        completedTurnCount: Number(item.completed_turn_count),
        contentSha256: item.content_sha256
      };
    }
    return {
      sourceType: 'conversation',
      completedTurnCount: Number(item.completed_turn_count),
      createdAt: date(item.reference_created_at),
      private: true
    };
  }

  async function insertReferences(executor, { solutionVersionId, references, timestamp }) {
    for (const reference of references) {
      const referenceId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
      await executor.query(`INSERT INTO content_references (
        id, source_type, source_id, target_type, target_id, knowledge_version_id, solution_version_id, created_at
      ) VALUES (?, ?, ?, 'solution_version', ?, NULL, ?, ?)`, [
        referenceId, reference.sourceType, reference.sourceId,
        solutionVersionId, solutionVersionId, timestamp
      ]);
      if (reference.sourceType === 'conversation' && reference.firstSequence !== undefined) {
        await executor.query(`INSERT INTO conversation_reference_details (
          content_reference_id, conversation_id, first_sequence, last_sequence,
          completed_turn_count, content_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
          referenceId, reference.conversationId || reference.sourceId, reference.firstSequence,
          reference.lastSequence, reference.completedTurnCount, reference.contentSha256, timestamp
        ]);
      }
    }
  }

  async function createKnowledgeDraft({ actorUserId, actorRole, title, category = '', tags = [], markdown, visibility = 'private', status = 'draft' }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const documentId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
    const versionId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
    const timestamp = now();
    const fields = {
      title: requiredText(title, 'INVALID_KNOWLEDGE_TITLE', { max: 200 }),
      category: requiredText(category, 'INVALID_KNOWLEDGE_CATEGORY', { max: 100, allowEmpty: true }),
      tags: normalizeTags(tags),
      markdown: requiredText(markdown, 'INVALID_KNOWLEDGE_MARKDOWN', { max: 1048576, multiline: true }),
      visibility: normalizeVisibility(visibility),
      status: normalizeStatus(status)
    };
    return db.transaction(async (tx) => {
      await tx.query(`INSERT INTO knowledge_documents (
        id, owner_user_id, status, visibility, current_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?)`, [documentId, actor.id, fields.status, fields.visibility, timestamp, timestamp]);
      await tx.query(`INSERT INTO knowledge_versions (
        id, document_id, version_number, title, category, tags_json, markdown, is_current, current_document_id, created_at, created_by_user_id
      ) VALUES (?, ?, 1, ?, ?, ?, ?, 1, ?, ?, ?)`, [
        versionId, documentId, fields.title, fields.category, JSON.stringify(fields.tags), fields.markdown, documentId, timestamp, actor.id
      ]);
      await tx.query('UPDATE knowledge_documents SET current_version_id = ? WHERE id = ?', [versionId, documentId]);
      return toKnowledgeSummary(await tx.one(`${knowledgeSelect} WHERE d.id = ?`, [documentId]));
    });
  }

  async function saveKnowledgeVersion({ actorUserId, actorRole, documentId, title, category, tags, markdown, visibility, status }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const timestamp = now();
    return db.transaction(async (tx) => {
      const existing = await writableKnowledge(tx, actor, documentId);
      const versionId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
      const next = {
        title: optionalText(title, 'INVALID_KNOWLEDGE_TITLE', { max: 200 }) ?? existing.title,
        category: optionalText(category, 'INVALID_KNOWLEDGE_CATEGORY', { max: 100, allowEmpty: true }) ?? existing.category,
        tags: tags === undefined ? parseTags(existing.tags_json) : normalizeTags(tags),
        markdown: optionalText(markdown, 'INVALID_KNOWLEDGE_MARKDOWN', { max: 1048576, multiline: true }) ?? existing.markdown,
        visibility: visibility === undefined ? existing.visibility : normalizeVisibility(visibility),
        status: status === undefined ? existing.status : normalizeStatus(status)
      };
      await tx.query('UPDATE knowledge_versions SET is_current = 0, current_document_id = NULL WHERE id = ?', [existing.version_id]);
      await tx.query(`INSERT INTO knowledge_versions (
        id, document_id, version_number, title, category, tags_json, markdown, is_current, current_document_id, created_at, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, [
        versionId, existing.document_id, Number(existing.version_number) + 1, next.title, next.category,
        JSON.stringify(next.tags), next.markdown, existing.document_id, timestamp, actor.id
      ]);
      await tx.query(`UPDATE knowledge_documents SET current_version_id = ?, visibility = ?, status = ?, updated_at = ? WHERE id = ?`, [
        versionId, next.visibility, next.status, timestamp, existing.document_id
      ]);
      return toKnowledgeSummary(await tx.one(`${knowledgeSelect} WHERE d.id = ?`, [existing.document_id]));
    });
  }

  async function getKnowledge({ actorUserId, actorRole, documentId, includeContent = false }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const row = await readableKnowledge(db, actor, documentId);
    const [references, history] = await Promise.all([
      knowledgeReferencesByVersion(db, row.version_id),
      db.many(`SELECT id, version_number, title, category, tags_json, created_at, created_by_user_id
      FROM knowledge_versions WHERE document_id = ? ORDER BY version_number DESC`, [row.document_id])
    ]);
    return {
      ...toKnowledgeSummary(row),
      ...(includeContent ? { markdown: row.markdown } : {}),
      references,
      versionHistory: history.map((version) => ({
        id: version.id, version: Number(version.version_number), title: version.title, category: version.category,
        tags: parseTags(version.tags_json), createdAt: date(version.created_at), createdByUserId: version.created_by_user_id
      }))
    };
  }

  async function searchKnowledge({ actorUserId, actorRole, query, limit = 20 }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const search = toMySqlSearchQuery(query);
    const normalizedLimit = Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : 20;
    if (!search) return [];
    const rows = await db.many(`SELECT d.id AS document_id, d.owner_user_id, d.status, d.visibility, d.created_at, d.updated_at,
      v.version_number, v.title, v.category, v.tags_json,
      LEFT(v.markdown, 240) AS preview
      FROM knowledge_documents d
      JOIN knowledge_versions v ON v.id = d.current_version_id
      WHERE MATCH(v.title, v.category, v.markdown) AGAINST (? IN BOOLEAN MODE)
        AND (d.owner_user_id = ? OR (d.visibility = 'team' AND d.status = 'published') OR ? = 'admin')
      ORDER BY d.updated_at DESC, d.id DESC LIMIT ?`, [search, actor.id, actor.role, normalizedLimit]);
    return rows.map((row) => ({ ...toKnowledgeSummary(row), preview: row.preview }));
  }

  async function listKnowledge({ actorUserId, actorRole }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const rows = await db.many(`${knowledgeSelect}
      WHERE d.owner_user_id = ? OR (d.visibility = 'team' AND d.status = 'published') OR ? = 'admin'
      ORDER BY d.updated_at DESC, d.id DESC`, [actor.id, actor.role]);
    return rows.map(toKnowledgeSummary);
  }

  async function createSolutionDraft({ actorUserId, actorRole, title, description = '', solutionMarkdown = '', references = [], visibility = 'private', status = 'draft' }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const solutionId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
    const versionId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
    const timestamp = now();
    const fields = {
      title: requiredText(title, 'INVALID_SOLUTION_TITLE', { max: 200 }),
      description: requiredText(description, 'INVALID_SOLUTION_DESCRIPTION', { max: 10000, allowEmpty: true, multiline: true }),
      solutionMarkdown: requiredText(solutionMarkdown, 'INVALID_SOLUTION_MARKDOWN', { max: 1048576, allowEmpty: true, multiline: true }),
      references: normalizeReferences(references), visibility: normalizeVisibility(visibility), status: normalizeStatus(status)
    };
    return db.transaction(async (tx) => {
      await tx.query(`INSERT INTO solutions (
        id, owner_user_id, status, visibility, current_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?)`, [solutionId, actor.id, fields.status, fields.visibility, timestamp, timestamp]);
      await tx.query(`INSERT INTO solution_versions (
        id, solution_id, version_number, title, description, solution_markdown, is_current, current_solution_id, created_at, created_by_user_id
      ) VALUES (?, ?, 1, ?, ?, ?, 1, ?, ?, ?)`, [
        versionId, solutionId, fields.title, fields.description, fields.solutionMarkdown, solutionId, timestamp, actor.id
      ]);
      await insertReferences(tx, { solutionVersionId: versionId, references: fields.references, timestamp });
      await tx.query('UPDATE solutions SET current_version_id = ? WHERE id = ?', [versionId, solutionId]);
      return toSolutionSummary(await tx.one(`${solutionSelect} WHERE s.id = ?`, [solutionId]));
    });
  }

  async function createSolutionFromConversation({ actorUserId, actorRole, conversationId, title, description = '', assistantMarkdown, firstSequence, lastSequence, completedTurnCount, contentSha256 }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const timestamp = now();
    const solutionId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
    const versionId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
    const referenceId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
    const fields = {
      title: requiredText(title, 'INVALID_SOLUTION_TITLE', { max: 200 }),
      description: requiredText(description, 'INVALID_SOLUTION_DESCRIPTION', { max: 10000, allowEmpty: true, multiline: true })
    };
    return db.transaction(async (tx) => {
      const source = await normalizeConversationSource(tx, {
        actor, conversationId, assistantMarkdown, firstSequence, lastSequence, completedTurnCount, contentSha256
      });
      await tx.query(`INSERT INTO solutions (
        id, owner_user_id, status, visibility, current_version_id, created_at, updated_at
      ) VALUES (?, ?, 'draft', 'private', NULL, ?, ?)`, [solutionId, actor.id, timestamp, timestamp]);
      await tx.query(`INSERT INTO solution_versions (
        id, solution_id, version_number, title, description, solution_markdown, is_current, current_solution_id, created_at, created_by_user_id
      ) VALUES (?, ?, 1, ?, ?, ?, 1, ?, ?, ?)`, [
        versionId, solutionId, fields.title, fields.description, source.assistantMarkdown, solutionId, timestamp, actor.id
      ]);
      await tx.query(`INSERT INTO content_references (
        id, source_type, source_id, target_type, target_id, knowledge_version_id, solution_version_id, created_at
      ) VALUES (?, 'conversation', ?, 'solution_version', ?, NULL, ?, ?)`, [
        referenceId, source.conversationId, versionId, versionId, timestamp
      ]);
      await tx.query(`INSERT INTO conversation_reference_details (
        content_reference_id, conversation_id, first_sequence, last_sequence,
        completed_turn_count, content_sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        referenceId, source.conversationId, source.firstSequence, source.lastSequence,
        source.completedTurnCount, source.contentSha256, timestamp
      ]);
      await tx.query('UPDATE solutions SET current_version_id = ? WHERE id = ?', [versionId, solutionId]);
      return toSolutionSummary(await tx.one(`${solutionSelect} WHERE s.id = ?`, [solutionId]));
    });
  }

  async function createKnowledgeFromSolution({ actorUserId, actorRole, solutionId, title, category = '', tags = [], markdown }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const timestamp = now();
    const documentId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
    const versionId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
    const referenceId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
    return db.transaction(async (tx) => {
      const source = await writableSolution(tx, actor, solutionId);
      const fields = {
        title: title === undefined ? source.title : requiredText(title, 'INVALID_KNOWLEDGE_TITLE', { max: 200 }),
        category: requiredText(category, 'INVALID_KNOWLEDGE_CATEGORY', { max: 100, allowEmpty: true }),
        tags: normalizeTags(tags),
        markdown: requiredText(markdown, 'INVALID_KNOWLEDGE_MARKDOWN', { max: 1048576, multiline: true }),
        visibility: 'private',
        status: 'draft'
      };
      await tx.query(`INSERT INTO knowledge_documents (
        id, owner_user_id, status, visibility, current_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?)`, [documentId, actor.id, fields.status, fields.visibility, timestamp, timestamp]);
      await tx.query(`INSERT INTO knowledge_versions (
        id, document_id, version_number, title, category, tags_json, markdown, is_current, current_document_id, created_at, created_by_user_id
      ) VALUES (?, ?, 1, ?, ?, ?, ?, 1, ?, ?, ?)`, [
        versionId, documentId, fields.title, fields.category, JSON.stringify(fields.tags), fields.markdown, documentId, timestamp, actor.id
      ]);
      await tx.query(`INSERT INTO content_references (
        id, source_type, source_id, target_type, target_id, knowledge_version_id, solution_version_id, created_at
      ) VALUES (?, 'solution_version', ?, 'knowledge_version', ?, ?, NULL, ?)`, [
        referenceId, source.version_id, versionId, versionId, timestamp
      ]);
      await tx.query('UPDATE knowledge_documents SET current_version_id = ? WHERE id = ?', [versionId, documentId]);
      return toKnowledgeSummary(await tx.one(`${knowledgeSelect} WHERE d.id = ?`, [documentId]));
    });
  }

  async function saveSolutionVersion({ actorUserId, actorRole, solutionId, title, description, solutionMarkdown, references, visibility, status }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const timestamp = now();
    return db.transaction(async (tx) => {
      const existing = await writableSolution(tx, actor, solutionId);
      const versionId = requiredText(idFactory(), 'INVALID_CONTENT_ID', { max: 200 });
      const next = {
        title: optionalText(title, 'INVALID_SOLUTION_TITLE', { max: 200 }) ?? existing.title,
        description: optionalText(description, 'INVALID_SOLUTION_DESCRIPTION', { max: 10000, allowEmpty: true, multiline: true }) ?? existing.description,
        solutionMarkdown: optionalText(solutionMarkdown, 'INVALID_SOLUTION_MARKDOWN', { max: 1048576, allowEmpty: true, multiline: true }) ?? existing.solution_markdown,
        references: references === undefined ? await referencesByVersion(tx, existing.version_id) : normalizeReferences(references),
        visibility: visibility === undefined ? existing.visibility : normalizeVisibility(visibility),
        status: status === undefined ? existing.status : normalizeStatus(status)
      };
      await tx.query('UPDATE solution_versions SET is_current = 0, current_solution_id = NULL WHERE id = ?', [existing.version_id]);
      await tx.query(`INSERT INTO solution_versions (
        id, solution_id, version_number, title, description, solution_markdown, is_current, current_solution_id, created_at, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, [
        versionId, existing.solution_id, Number(existing.version_number) + 1, next.title, next.description,
        next.solutionMarkdown, existing.solution_id, timestamp, actor.id
      ]);
      await insertReferences(tx, { solutionVersionId: versionId, references: next.references, timestamp });
      await tx.query(`UPDATE solutions SET current_version_id = ?, visibility = ?, status = ?, updated_at = ? WHERE id = ?`, [
        versionId, next.visibility, next.status, timestamp, existing.solution_id
      ]);
      return toSolutionSummary(await tx.one(`${solutionSelect} WHERE s.id = ?`, [existing.solution_id]));
    });
  }

  async function getSolution({ actorUserId, actorRole, solutionId, includeContent = false }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const row = await readableSolution(db, actor, solutionId);
    const [references, history] = await Promise.all([
      referencesByVersion(db, row.version_id),
      db.many(`SELECT id, version_number, title, created_at, created_by_user_id
        FROM solution_versions WHERE solution_id = ? ORDER BY version_number DESC`, [row.solution_id])
    ]);
    return {
      ...toSolutionSummary(row),
      ...(includeContent ? { description: row.description, solutionMarkdown: row.solution_markdown } : {}),
      references: references.map((item) => toReferenceCard(item, { ownerUserId: row.owner_user_id, actor })),
      versionHistory: history.map((version) => ({
        id: version.id, version: Number(version.version_number), title: version.title,
        createdAt: date(version.created_at), createdByUserId: version.created_by_user_id
      }))
    };
  }

  async function listSolutions({ actorUserId, actorRole }) {
    const actor = normalizeActor({ actorUserId, actorRole });
    const rows = await db.many(`${solutionSelect}
      WHERE s.owner_user_id = ? OR (s.visibility = 'team' AND s.status = 'published') OR ? = 'admin'
      ORDER BY s.updated_at DESC, s.id DESC`, [actor.id, actor.role]);
    return rows.map(toSolutionSummary);
  }

  function publishKnowledge({ actorUserId, actorRole, documentId }) {
    return saveKnowledgeVersion({ actorUserId, actorRole, documentId, status: 'published', visibility: 'team' });
  }

  function withdrawKnowledge({ actorUserId, actorRole, documentId }) {
    return saveKnowledgeVersion({ actorUserId, actorRole, documentId, status: 'withdrawn', visibility: 'private' });
  }

  function publishSolution({ actorUserId, actorRole, solutionId }) {
    return saveSolutionVersion({ actorUserId, actorRole, solutionId, status: 'published', visibility: 'team' });
  }

  function withdrawSolution({ actorUserId, actorRole, solutionId }) {
    return saveSolutionVersion({ actorUserId, actorRole, solutionId, status: 'withdrawn', visibility: 'private' });
  }

  return Object.freeze({
    createKnowledgeDraft, saveKnowledgeVersion, getKnowledge, searchKnowledge, listKnowledge,
    createSolutionDraft, createSolutionFromConversation, createKnowledgeFromSolution, saveSolutionVersion, getSolution, listSolutions,
    publishKnowledge, withdrawKnowledge, publishSolution, withdrawSolution
  });
}

module.exports = { createMySqlContentStore };
