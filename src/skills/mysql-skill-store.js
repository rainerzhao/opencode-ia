'use strict';

const crypto = require('node:crypto');
const { toIsoTimestamp, toMySqlTimestamp } = require('../users/mysql-user-store');
const { normalizeSkillFiles, skillPackageDigest } = require('./skill-package');

function skillError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function required(value, code, message, { max = 200, multiline = false } = {}) {
  if (typeof value !== 'string') throw skillError(code, message);
  const normalized = value.trim();
  const unsafe = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (!normalized || Array.from(normalized).length > max || unsafe.test(normalized)) throw skillError(code, message);
  return normalized;
}

function actor(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || !['member', 'admin'].includes(value.role)) {
    throw skillError('INVALID_SKILL_ACTOR', 'skill actor is invalid');
  }
  return { id: value.id, role: value.role };
}

function slug(value) {
  const normalized = required(value, 'INVALID_SKILL_SLUG', 'skill slug is invalid', { max: 64 }).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) || normalized.length < 2) {
    throw skillError('INVALID_SKILL_SLUG', 'skill slug is invalid');
  }
  return normalized;
}

function description(value = '') {
  if (typeof value !== 'string' || value.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(value.trim())) {
    throw skillError('INVALID_SKILL_DESCRIPTION', 'skill description is invalid');
  }
  return value.trim();
}

function parseReport(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return {}; }
}

function timestamp(clock) {
  const value = clock();
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw skillError('INVALID_SKILL_TIMESTAMP', 'skill timestamp is invalid');
  return toMySqlTimestamp(value);
}

function toDetail(row) {
  if (!row) return null;
  return {
    id: row.id, ownerUserId: row.owner_user_id, slug: row.slug, displayName: row.display_name,
    description: row.description, status: row.status, visibility: row.visibility,
    version: {
      id: row.version_id, version: row.version, status: row.version_status, skillMd: row.skill_md,
      validationReport: parseReport(row.validation_report_json), contentSha256: row.content_sha256,
      createdAt: toIsoTimestamp(row.version_created_at), updatedAt: toIsoTimestamp(row.version_updated_at),
      publishedAt: toIsoTimestamp(row.published_at)
    },
    files: [], createdAt: toIsoTimestamp(row.created_at), updatedAt: toIsoTimestamp(row.updated_at)
  };
}

function toInstallation(row) {
  if (!row) return null;
  return {
    id: row.installation_id, userId: row.user_id, skillId: row.skill_id, versionId: row.version_id,
    status: row.installation_status, slug: row.slug, displayName: row.display_name,
    description: row.description, version: row.version, contentSha256: row.content_sha256,
    createdAt: toIsoTimestamp(row.installation_created_at), updatedAt: toIsoTimestamp(row.installation_updated_at)
  };
}

function toFile(row) {
  return {
    id: row.id, path: row.path, content: row.content, sizeBytes: row.size_bytes,
    contentSha256: row.content_sha256, createdAt: toIsoTimestamp(row.created_at), updatedAt: toIsoTimestamp(row.updated_at)
  };
}

function createMySqlSkillStore(db, { idFactory = crypto.randomUUID, clock = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.query !== 'function' || typeof db.one !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('MySQL skill database is required');
  }
  const detailSql = `SELECT s.*, v.id AS version_id, v.version, v.status AS version_status,
    v.skill_md, v.validation_report_json, v.content_sha256, v.created_at AS version_created_at,
    v.updated_at AS version_updated_at, v.published_at FROM skills s JOIN skill_versions v ON v.skill_id = s.id`;
  const installationSql = `SELECT i.id AS installation_id, i.user_id, i.skill_id, i.version_id,
    i.status AS installation_status, i.created_at AS installation_created_at, i.updated_at AS installation_updated_at,
    s.slug, s.display_name, s.description, v.version, v.content_sha256 FROM skill_installations i
    JOIN skills s ON s.id = i.skill_id JOIN skill_versions v ON v.id = i.version_id AND v.skill_id = i.skill_id`;
  const id = (value, code = 'INVALID_SKILL_ID') => required(value, code, 'skill id is invalid');
  const filesForVersion = async (executor, versionId) => (await executor.many('SELECT * FROM skill_files WHERE version_id = ? ORDER BY path ASC', [versionId])).map(toFile);
  const detail = async (executor, row) => {
    const result = toDetail(row);
    if (result) result.files = await filesForVersion(executor, result.version.id);
    return result;
  };
  const latest = (executor, skillId) => executor.one(`${detailSql} WHERE s.id = ? ORDER BY v.created_at DESC, v.id DESC LIMIT 1`, [skillId]);
  const published = (executor, skillId) => executor.one(`${detailSql} WHERE s.id = ? AND v.status = 'published' ORDER BY v.published_at DESC, v.id DESC LIMIT 1`, [skillId]);

  async function editable(executor, who, skillId) {
    const row = await latest(executor, id(skillId));
    if (!row || (who.role !== 'admin' && row.owner_user_id !== who.id)) throw skillError('SKILL_NOT_FOUND', 'skill was not found');
    return row;
  }

  async function createDraft({ actor: actorInput, slug: slugInput, displayName, description: descriptionInput = '', skillMd }) {
    const who = actor(actorInput); const normalizedSlug = slug(slugInput);
    const name = required(displayName, 'INVALID_SKILL_DISPLAY_NAME', 'skill display name is invalid', { max: 100 });
    const source = required(skillMd, 'INVALID_SKILL_SOURCE', 'skill source is invalid', { max: 262144, multiline: true });
    if (Buffer.byteLength(source) > 262144) throw skillError('INVALID_SKILL_SOURCE', 'skill source is invalid');
    const skillId = id(idFactory()); const versionId = id(idFactory(), 'INVALID_SKILL_VERSION_ID'); const now = timestamp(clock);
    const digest = crypto.createHash('sha256').update(source).digest('hex');
    try {
      await db.transaction(async (tx) => {
        await tx.query(`INSERT INTO skills (id, owner_user_id, slug, display_name, description, status, visibility, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'draft', 'private', ?, ?)`, [skillId, who.id, normalizedSlug, name, description(descriptionInput), now, now]);
        await tx.query(`INSERT INTO skill_versions (id, skill_id, version, status, skill_md, validation_report_json, content_sha256, created_by_user_id, created_at, updated_at)
          VALUES (?, ?, '0.1.0', 'draft', ?, '{}', ?, ?, ?, ?)`, [versionId, skillId, source, digest, who.id, now, now]);
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') throw skillError('SKILL_SLUG_CONFLICT', 'skill slug already exists');
      if (error?.code === 'ER_NO_REFERENCED_ROW_2') throw skillError('SKILL_OWNER_NOT_FOUND', 'skill owner was not found');
      throw error;
    }
    return detail(db, await latest(db, skillId));
  }

  async function getVisible({ actor: actorInput, id: skillId }) {
    const who = actor(actorInput); const row = await latest(db, id(skillId));
    if (!row || (who.role !== 'admin' && row.owner_user_id !== who.id && !(row.status === 'published' && row.visibility === 'team'))) return null;
    if (who.role !== 'admin' && row.owner_user_id !== who.id) return detail(db, await published(db, row.id));
    return detail(db, row);
  }

  async function listVisible({ actor: actorInput, status = 'draft', limit = 100, offset = 0 } = {}) {
    const who = actor(actorInput);
    if (!['all', 'draft', 'published', 'disabled', 'archived'].includes(status)) throw skillError('INVALID_SKILL_STATUS', 'skill status is invalid');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw skillError('INVALID_SKILL_PAGE', 'skill page is invalid');
    const rows = await db.many(`${detailSql}
      WHERE (? = 'all' OR s.status = ?) AND (? = 'admin' OR s.owner_user_id = ? OR (s.visibility = 'team' AND s.status IN ('published', 'disabled')))
      ORDER BY s.updated_at DESC, s.id DESC`, [status, status, who.role, who.id]);
    const selected = new Map();
    for (const row of rows) {
      if (!selected.has(row.id) && (who.role === 'admin' || row.owner_user_id === who.id || ['published', 'retired'].includes(row.version_status))) selected.set(row.id, row);
    }
    return [...selected.values()].slice(offset, offset + limit).map((row) => ({ id: row.id, ownerUserId: row.owner_user_id, slug: row.slug, displayName: row.display_name, description: row.description, status: row.status, visibility: row.visibility, version: row.version, versionStatus: row.version_status, createdAt: toIsoTimestamp(row.created_at), updatedAt: toIsoTimestamp(row.updated_at) }));
  }

  async function replaceDraftFiles({ actor: actorInput, id: skillId, files }) {
    const who = actor(actorInput);
    return db.transaction(async (tx) => {
      const row = await editable(tx, who, skillId);
      if (!['draft', 'published'].includes(row.status) || !['draft', 'validated'].includes(row.version_status)) throw skillError('SKILL_NOT_EDITABLE', 'skill draft cannot be changed');
      const normalized = normalizeSkillFiles(files, row.skill_md);
      const now = timestamp(clock);
      await tx.query('DELETE FROM skill_files WHERE version_id = ?', [row.version_id]);
      for (const file of normalized) await tx.query(`INSERT INTO skill_files (id, version_id, path, content, size_bytes, content_sha256, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id(idFactory(), 'INVALID_SKILL_FILE_ID'), row.version_id, file.path, file.content, file.sizeBytes, crypto.createHash('sha256').update(file.content).digest('hex'), now, now]);
      await tx.query(`UPDATE skill_versions SET status = 'draft', validation_report_json = '{}', content_sha256 = ?, updated_at = ? WHERE id = ?`, [skillPackageDigest(row.skill_md, normalized), now, row.version_id]);
      await tx.query('UPDATE skills SET updated_at = ? WHERE id = ?', [now, row.id]);
      return detail(tx, await latest(tx, row.id));
    });
  }

  async function getValidationCandidate({ actor: actorInput, id: skillId }) {
    const who = actor(actorInput);
    const row = await editable(db, who, skillId);
    if (!['draft', 'published'].includes(row.status) || !['draft', 'validated'].includes(row.version_status)) {
      throw skillError('SKILL_NOT_EDITABLE', 'skill draft cannot be validated');
    }
    return detail(db, row);
  }

  async function getPublishedInstallCandidate({ actor: actorInput, id: skillId }) {
    actor(actorInput);
    const row = await published(db, id(skillId));
    if (!row || row.status !== 'published' || row.visibility !== 'team' || row.version_status !== 'published') {
      throw skillError('SKILL_NOT_FOUND', 'skill was not found');
    }
    return detail(db, row);
  }

  async function getInstalledEnableCandidate({ actor: actorInput, id: skillId, versionId }) {
    actor(actorInput);
    const row = await db.one(`${detailSql} WHERE s.id = ? AND v.id = ?`, [id(skillId), id(versionId, 'INVALID_SKILL_VERSION_ID')]);
    if (!row || row.status !== 'published' || row.visibility !== 'team' || !['published', 'retired'].includes(row.version_status)) {
      throw skillError('SKILL_NOT_INSTALLABLE', 'skill version cannot be enabled');
    }
    return detail(db, row);
  }

  async function getVersionChangeCandidate({ actor: actorInput, id: skillId, versionId, operation }) {
    actor(actorInput);
    if (!['upgrade', 'rollback'].includes(operation)) throw skillError('INVALID_SKILL_VERSION_OPERATION', 'skill version operation is invalid');
    const row = await db.one(`${detailSql} WHERE s.id = ? AND v.id = ?`, [id(skillId), id(versionId, 'INVALID_SKILL_VERSION_ID')]);
    const expected = operation === 'upgrade' ? 'published' : 'retired';
    if (!row || row.status !== 'published' || row.visibility !== 'team' || row.version_status !== expected) throw skillError('SKILL_VERSION_NOT_SELECTABLE', 'skill version cannot be selected');
    return detail(db, row);
  }

  async function updateDraft({ actor: actorInput, id: skillId, displayName, description: descriptionInput, skillMd }) {
    const who = actor(actorInput);
    return db.transaction(async (tx) => {
      const row = await editable(tx, who, skillId);
      if (!['draft', 'published'].includes(row.status) || !['draft', 'validated'].includes(row.version_status)) throw skillError('SKILL_NOT_EDITABLE', 'skill draft cannot be changed');
      if (displayName === undefined && descriptionInput === undefined && skillMd === undefined) throw skillError('INVALID_SKILL_UPDATE', 'skill update is empty');
      const source = skillMd === undefined ? row.skill_md : required(skillMd, 'INVALID_SKILL_SOURCE', 'skill source is invalid', { max: 262144, multiline: true });
      if (Buffer.byteLength(source) > 262144) throw skillError('INVALID_SKILL_SOURCE', 'skill source is invalid');
      const files = await filesForVersion(tx, row.version_id); const now = timestamp(clock);
      await tx.query('UPDATE skills SET display_name = ?, description = ?, updated_at = ? WHERE id = ?', [displayName === undefined ? row.display_name : required(displayName, 'INVALID_SKILL_DISPLAY_NAME', 'skill display name is invalid', { max: 100 }), descriptionInput === undefined ? row.description : description(descriptionInput), now, row.id]);
      await tx.query(`UPDATE skill_versions SET skill_md = ?, status = 'draft', validation_report_json = '{}', content_sha256 = ?, updated_at = ? WHERE id = ?`, [source, skillPackageDigest(source, files), now, row.version_id]);
      return detail(tx, await latest(tx, row.id));
    });
  }

  async function listReleaseVersions({ actor: actorInput, id: skillId }) {
    const who = actor(actorInput); const row = await getVisible({ actor: who, id: skillId });
    if (!row) throw skillError('SKILL_NOT_FOUND', 'skill was not found');
    const versions = await db.many(`SELECT id, version, status, content_sha256, created_at, updated_at, published_at
      FROM skill_versions WHERE skill_id = ? ORDER BY created_at DESC, id DESC`, [row.id]);
    return versions.filter((version) => who.role === 'admin' || row.ownerUserId === who.id || ['published', 'retired'].includes(version.status)).map((version) => ({
      id: version.id, version: version.version, status: version.status, contentSha256: version.content_sha256,
      createdAt: toIsoTimestamp(version.created_at), updatedAt: toIsoTimestamp(version.updated_at), publishedAt: toIsoTimestamp(version.published_at)
    }));
  }

  async function saveValidationReport({ actor: actorInput, id: skillId, expectedContentSha256, report }) {
    const who = actor(actorInput);
    if (typeof expectedContentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedContentSha256) || !report || typeof report !== 'object') {
      throw skillError('INVALID_SKILL_VALIDATION_REPORT', 'skill validation report is invalid');
    }
    return db.transaction(async (tx) => {
      const row = await editable(tx, who, skillId);
      if (row.content_sha256 !== expectedContentSha256) throw skillError('SKILL_VALIDATION_STALE', 'skill changed while validation was running');
      const status = report.verdict === 'pass' && report.runtime?.status === 'passed' ? 'validated' : 'draft';
      await tx.query('UPDATE skill_versions SET status = ?, validation_report_json = ?, updated_at = ? WHERE id = ?', [status, JSON.stringify(report), timestamp(clock), row.version_id]);
      await tx.query('UPDATE skills SET updated_at = ? WHERE id = ?', [timestamp(clock), row.id]);
      return toDetail(await latest(tx, row.id));
    });
  }

  async function publishValidated({ actor: actorInput, id: skillId }) {
    const who = actor(actorInput);
    return db.transaction(async (tx) => {
      const row = await editable(tx, who, skillId);
      if (row.status === 'published' && row.visibility === 'team' && row.version_status === 'published') return toDetail(row);
      const report = parseReport(row.validation_report_json);
      if (row.version_status !== 'validated' || report.verdict !== 'pass' || report.runtime?.status !== 'passed' || report.contentSha256 !== row.content_sha256) {
        throw skillError('SKILL_NOT_PUBLISHABLE', 'skill has not passed current validation');
      }
      const now = timestamp(clock);
      await tx.query("UPDATE skills SET status = 'published', visibility = 'team', updated_at = ? WHERE id = ?", [now, row.id]);
      if (row.status === 'published') {
        await tx.query("UPDATE skill_versions SET status = 'retired', updated_at = ? WHERE skill_id = ? AND status = 'published'", [now, row.id]);
      }
      await tx.query("UPDATE skill_versions SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?", [now, now, row.version_id]);
      return toDetail(await published(tx, row.id));
    });
  }

  async function recordInstallation({ actor: actorInput, skillId, versionId }) {
    const who = actor(actorInput); const normalizedSkill = id(skillId); const normalizedVersion = id(versionId, 'INVALID_SKILL_VERSION_ID');
    return db.transaction(async (tx) => {
      const candidate = await tx.one(`${detailSql} WHERE s.id = ? AND v.id = ? AND s.status = 'published' AND s.visibility = 'team' AND v.status = 'published'`, [normalizedSkill, normalizedVersion]);
      if (!candidate) throw skillError('SKILL_NOT_INSTALLABLE', 'skill version cannot be installed');
      const existing = await tx.one(`${installationSql} WHERE i.user_id = ? AND i.skill_id = ?`, [who.id, normalizedSkill]);
      if (existing) {
        if (existing.version_id !== normalizedVersion) throw skillError('SKILL_INSTALL_VERSION_CONFLICT', 'another skill version is already installed');
        return toInstallation(existing);
      }
      await tx.query(`INSERT INTO skill_installations (id, user_id, skill_id, version_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'installed', ?, ?)`, [id(idFactory(), 'INVALID_SKILL_INSTALLATION_ID'), who.id, normalizedSkill, normalizedVersion, timestamp(clock), timestamp(clock)]);
      return toInstallation(await tx.one(`${installationSql} WHERE i.user_id = ? AND i.skill_id = ?`, [who.id, normalizedSkill]));
    });
  }

  async function setInstallationStatus({ actor: actorInput, skillId, status }) {
    const who = actor(actorInput); const normalizedSkill = id(skillId);
    if (!['installed', 'enabled', 'disabled'].includes(status)) throw skillError('INVALID_SKILL_INSTALLATION_STATUS', 'skill installation status is invalid');
    const existing = await db.one(`${installationSql} WHERE i.user_id = ? AND i.skill_id = ?`, [who.id, normalizedSkill]);
    if (!existing) throw skillError('SKILL_INSTALLATION_NOT_FOUND', 'skill installation was not found');
    if (existing.installation_status !== status) await db.query('UPDATE skill_installations SET status = ?, updated_at = ? WHERE user_id = ? AND skill_id = ?', [status, timestamp(clock), who.id, normalizedSkill]);
    return toInstallation(await db.one(`${installationSql} WHERE i.user_id = ? AND i.skill_id = ?`, [who.id, normalizedSkill]));
  }

  async function createSuccessorDraft({ actor: actorInput, id: skillId }) {
    const who = actor(actorInput);
    return db.transaction(async (tx) => {
      const row = await editable(tx, who, skillId);
      if (row.status !== 'published' || row.visibility !== 'team' || row.version_status !== 'published') throw skillError('SKILL_VERSION_NOT_CREATABLE', 'skill version cannot be created');
      const versions = await tx.many('SELECT version FROM skill_versions WHERE skill_id = ?', [row.id]);
      const greatest = versions.reduce((best, item) => {
        const current = item.version.split('.').map(Number); return !best || current[0] > best[0] || (current[0] === best[0] && current[1] > best[1]) ? current : best;
      }, null);
      const versionId = id(idFactory(), 'INVALID_SKILL_VERSION_ID'); const now = timestamp(clock);
      await tx.query(`INSERT INTO skill_versions (id, skill_id, version, status, skill_md, validation_report_json, content_sha256, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, 'draft', ?, '{}', ?, ?, ?, ?)`, [versionId, row.id, `${greatest[0]}.${greatest[1] + 1}.0`, row.skill_md, row.content_sha256, who.id, now, now]);
      for (const file of await filesForVersion(tx, row.version_id)) {
        await tx.query(`INSERT INTO skill_files (id, version_id, path, content, size_bytes, content_sha256, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id(idFactory(), 'INVALID_SKILL_FILE_ID'), versionId, file.path, file.content, file.sizeBytes, file.contentSha256, now, now]);
      }
      await tx.query('UPDATE skills SET updated_at = ? WHERE id = ?', [now, row.id]);
      return detail(tx, await latest(tx, row.id));
    });
  }

  async function selectInstallationVersion({ actor: actorInput, skillId, versionId, operation }) {
    const who = actor(actorInput); const normalizedSkill = id(skillId); const normalizedVersion = id(versionId, 'INVALID_SKILL_VERSION_ID');
    if (!['upgrade', 'rollback'].includes(operation)) throw skillError('INVALID_SKILL_VERSION_OPERATION', 'skill version operation is invalid');
    return db.transaction(async (tx) => {
      const installation = await tx.one(`${installationSql} WHERE i.user_id = ? AND i.skill_id = ?`, [who.id, normalizedSkill]);
      if (!installation) throw skillError('SKILL_INSTALLATION_NOT_FOUND', 'skill installation was not found');
      const target = await tx.one(`${detailSql} WHERE s.id = ? AND v.id = ?`, [normalizedSkill, normalizedVersion]);
      const status = operation === 'upgrade' ? 'published' : 'retired';
      if (!target || target.status !== 'published' || target.visibility !== 'team' || target.version_status !== status) throw skillError('SKILL_VERSION_NOT_SELECTABLE', 'skill version cannot be selected');
      await tx.query("UPDATE skill_installations SET version_id = ?, status = 'installed', updated_at = ? WHERE user_id = ? AND skill_id = ?", [normalizedVersion, timestamp(clock), who.id, normalizedSkill]);
      return toInstallation(await tx.one(`${installationSql} WHERE i.user_id = ? AND i.skill_id = ?`, [who.id, normalizedSkill]));
    });
  }

  async function listInstallations({ actor: actorInput }) {
    const who = actor(actorInput);
    return (await db.many(`${installationSql} WHERE i.user_id = ? ORDER BY i.updated_at DESC, i.id DESC`, [who.id])).map(toInstallation);
  }

  async function listEnabledInstallations({ userId }) {
    const user = id(userId, 'INVALID_SKILL_USER_ID');
    return (await db.many(`${installationSql}
      WHERE i.user_id = ? AND i.status = 'enabled' AND s.status = 'published'
      ORDER BY s.slug ASC`, [user])).map(toInstallation);
  }

  async function disableTeamSkill({ actor: actorInput, id: skillId }) {
    const who = actor(actorInput);
    return db.transaction(async (tx) => {
      const row = await editable(tx, who, skillId);
      if (row.status !== 'published') throw skillError('SKILL_NOT_DISABLEABLE', 'skill cannot be disabled from its current status');
      const now = timestamp(clock); await tx.query("UPDATE skills SET status = 'disabled', updated_at = ? WHERE id = ?", [now, row.id]);
      await tx.query("UPDATE skill_installations SET status = 'disabled', updated_at = ? WHERE skill_id = ? AND status = 'enabled'", [now, row.id]);
      return toDetail(await latest(tx, row.id));
    });
  }

  async function archiveDraft({ actor: actorInput, id: skillId }) {
    const who = actor(actorInput);
    return db.transaction(async (tx) => {
      const row = await editable(tx, who, skillId);
      if (row.status === 'archived') return detail(tx, row);
      if (row.status !== 'draft') throw skillError('SKILL_NOT_ARCHIVABLE', 'skill cannot be archived from its current status');
      await tx.query("UPDATE skills SET status = 'archived', updated_at = ? WHERE id = ?", [timestamp(clock), row.id]);
      return detail(tx, await latest(tx, row.id));
    });
  }

  async function archiveTeamSkill({ actor: actorInput, id: skillId }) {
    const who = actor(actorInput);
    return db.transaction(async (tx) => {
      const row = await editable(tx, who, skillId);
      if (row.status !== 'disabled') throw skillError('SKILL_NOT_ARCHIVABLE', 'skill cannot be archived from its current status');
      const now = timestamp(clock); await tx.query("UPDATE skills SET status = 'archived', updated_at = ? WHERE id = ?", [now, row.id]);
      await tx.query("UPDATE skill_installations SET status = 'disabled', updated_at = ? WHERE skill_id = ?", [now, row.id]);
      return toDetail(await latest(tx, row.id));
    });
  }

  return Object.freeze({ archiveDraft, archiveTeamSkill, createDraft, createSuccessorDraft, disableTeamSkill, getInstalledEnableCandidate, getPublishedInstallCandidate, getValidationCandidate, getVersionChangeCandidate, getVisible, listEnabledInstallations, listInstallations, listReleaseVersions, listVisible, publishValidated, recordInstallation, replaceDraftFiles, saveValidationReport, selectInstallationVersion, setInstallationStatus, updateDraft });
}

module.exports = { createMySqlSkillStore };
