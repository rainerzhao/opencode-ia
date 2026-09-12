'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { extractAttachmentText } = require('../../content/attachment-parser');

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

function attachmentError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function mapAttachmentError(error) {
  if (!error.status) {
    if (error.code === 'ATTACHMENT_CONFLICT') error.status = 409;
    else if (error.code === 'CONTENT_NOT_FOUND') error.status = 404;
    else if (error.code === 'INVALID_ATTACHMENT') error.status = 400;
    else if (error.code === 'ATTACHMENT_PARSE_UNSUPPORTED') error.status = 415;
    else if (error.code === 'ATTACHMENT_PARSE_INVALID') error.status = 422;
    else if (error.code === 'ATTACHMENT_EXPORT_TOO_LARGE') error.status = 413;
    else if (error.code === 'INVALID_KNOWLEDGE_BUNDLE') error.status = 400;
    else if (error.code === 'CONTENT_CONFLICT') error.status = 409;
    else if (['INVALID_KNOWLEDGE_TITLE', 'INVALID_KNOWLEDGE_CATEGORY', 'INVALID_KNOWLEDGE_MARKDOWN', 'INVALID_KNOWLEDGE_TAGS'].includes(error.code)) error.status = 400;
  }
  return error;
}

function parseKnowledgeBundle(value, safeFileName, allowedExtensions) {
  if (!value || typeof value !== 'object' || value.type !== 'knowledge-bundle' || value.schemaVersion !== 1) {
    throw attachmentError('INVALID_KNOWLEDGE_BUNDLE', 'knowledge bundle is invalid');
  }
  const source = value.knowledge;
  if (!source || typeof source !== 'object') throw attachmentError('INVALID_KNOWLEDGE_BUNDLE', 'knowledge bundle is invalid');
  if (value.attachments !== undefined && !Array.isArray(value.attachments)) throw attachmentError('INVALID_KNOWLEDGE_BUNDLE', 'knowledge bundle attachments are invalid');
  const attachments = Array.isArray(value.attachments) ? value.attachments : [];
  if (attachments.length > 50) throw attachmentError('ATTACHMENT_EXPORT_TOO_LARGE', 'knowledge bundle has too many attachments', 413);
  let totalBytes = 0;
  const files = attachments.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.contentBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.contentBase64) || item.contentBase64.length % 4 !== 0) {
      throw attachmentError('INVALID_KNOWLEDGE_BUNDLE', 'knowledge bundle attachment is invalid');
    }
    const content = Buffer.from(item.contentBase64, 'base64');
    if (content.toString('base64') !== item.contentBase64) throw attachmentError('INVALID_KNOWLEDGE_BUNDLE', 'knowledge bundle attachment is invalid');
    const originalName = safeFileName(item.originalName);
    if (!allowedExtensions.has(path.extname(originalName).toLowerCase())) throw attachmentError('ATTACHMENT_EXTENSION_NOT_ALLOWED', 'attachment extension is not allowed');
    const sizeBytes = Number(item.sizeBytes);
    const contentSha256 = typeof item.contentSha256 === 'string' ? item.contentSha256.toLowerCase() : '';
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    if (!Number.isInteger(sizeBytes) || sizeBytes !== content.length || sizeBytes > 50 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(contentSha256) || contentSha256 !== digest) {
      throw attachmentError('INVALID_KNOWLEDGE_BUNDLE', 'knowledge bundle attachment is invalid');
    }
    totalBytes += content.length;
    if (totalBytes > MAX_IMPORT_BYTES) throw attachmentError('ATTACHMENT_EXPORT_TOO_LARGE', 'knowledge bundle is too large', 413);
    const mediaType = item.mediaType === undefined ? 'application/octet-stream' : item.mediaType;
    if (typeof mediaType !== 'string' || mediaType.length < 1 || mediaType.length > 200 || /[\u0000-\u001f\u007f]/.test(mediaType)) throw attachmentError('INVALID_KNOWLEDGE_BUNDLE', 'knowledge bundle attachment is invalid');
    return { originalName, mediaType, content, sizeBytes, contentSha256 };
  });
  return {
    title: source.title,
    category: source.category,
    tags: source.tags,
    markdown: source.markdown,
    files
  };
}

function createContentAttachmentRouter({ store, uploadMiddleware, attachmentRoot, safeFileName, ensurePrivateDirectory, requestAuditor = null }) {
  if (!store || typeof store.createKnowledgeAttachment !== 'function' || typeof uploadMiddleware !== 'function' ||
    !attachmentRoot || typeof safeFileName !== 'function' || typeof ensurePrivateDirectory !== 'function') {
    throw new TypeError('content attachment route dependencies are required');
  }
  const router = express.Router();
  const allowedExtensions = new Set(['.md', '.txt', '.docx', '.pdf', '.json', '.csv']);
  const maxExportBytes = 20 * 1024 * 1024;

  router.post('/knowledge/import', async (req, res, next) => {
    const temporary = path.join(attachmentRoot, `.import-${crypto.randomUUID()}`);
    const createdTargets = [];
    let createdKnowledge = null;
    try {
      const bundle = parseKnowledgeBundle(req.body, safeFileName, allowedExtensions);
      const knowledge = await Promise.resolve(store.createKnowledgeDraft({
        actorUserId: req.auth.user.id, actorRole: req.auth.user.role,
        title: bundle.title, category: bundle.category, tags: bundle.tags, markdown: bundle.markdown,
        visibility: 'private', status: 'draft'
      }));
      createdKnowledge = knowledge;
      ensurePrivateDirectory(temporary);
      for (const file of bundle.files) {
        const id = crypto.randomUUID();
        const storageKey = `${safeFileName(req.auth.user.id)}/${safeFileName(knowledge.id)}/${id}${path.extname(file.originalName).toLowerCase()}`;
        const target = path.join(attachmentRoot, ...storageKey.split('/'));
        ensurePrivateDirectory(path.dirname(target));
        const staged = path.join(temporary, id);
        fs.writeFileSync(staged, file.content, { mode: 0o600, flag: 'wx' });
        fs.renameSync(staged, target);
        createdTargets.push(target);
        await Promise.resolve(store.createKnowledgeAttachment({
          actorUserId: req.auth.user.id, actorRole: req.auth.user.role, documentId: knowledge.id,
          id, originalName: file.originalName, mediaType: file.mediaType, sizeBytes: file.sizeBytes,
          contentSha256: file.contentSha256, storageKey
        }));
      }
      if (requestAuditor) requestAuditor.record(req, {
        action: 'content.knowledge.import', targetType: 'knowledge_document', targetId: knowledge.id,
        metadata: { attachmentCount: bundle.files.length }
      });
      res.status(201).json({ knowledge });
    } catch (error) {
      for (const target of createdTargets) { try { fs.unlinkSync(target); } catch {} }
      if (createdKnowledge && typeof store.deleteKnowledgeDraft === 'function') {
        await Promise.resolve(store.deleteKnowledgeDraft({
          actorUserId: req.auth.user.id, actorRole: req.auth.user.role, documentId: createdKnowledge.id
        })).catch(() => {});
      }
      next(mapAttachmentError(error));
    } finally {
      try { fs.rmSync(temporary, { recursive: true, force: true }); } catch {}
    }
  });

  router.post('/knowledge/:contentId/attachments', uploadMiddleware, async (req, res, next) => {
    const temporary = req.file?.path;
    let target = null;
    try {
      if (!req.file) throw attachmentError('INVALID_ATTACHMENT', 'one attachment file is required');
      const originalName = safeFileName(Buffer.from(req.file.originalname, 'latin1').toString('utf8'));
      const extension = path.extname(originalName).toLowerCase();
      if (!allowedExtensions.has(extension)) throw attachmentError('ATTACHMENT_EXTENSION_NOT_ALLOWED', 'attachment extension is not allowed');
      const userSegment = safeFileName(req.auth.user.id);
      const documentSegment = safeFileName(req.params.contentId);
      const storageKey = `${userSegment}/${documentSegment}/${crypto.randomUUID()}${extension}`;
      target = path.join(attachmentRoot, ...storageKey.split('/'));
      ensurePrivateDirectory(path.dirname(target));
      fs.renameSync(temporary, target);
      const digest = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
      const attachment = await Promise.resolve(store.createKnowledgeAttachment({
        actorUserId: req.auth.user.id, actorRole: req.auth.user.role, documentId: req.params.contentId,
        id: crypto.randomUUID(), originalName, mediaType: req.file.mimetype || 'application/octet-stream',
        sizeBytes: req.file.size, contentSha256: digest, storageKey
      }));
      res.status(201).json({ attachment });
    } catch (error) {
      if (target) { try { fs.unlinkSync(target); } catch {} }
      next(mapAttachmentError(error));
    } finally {
      if (temporary) { try { fs.unlinkSync(temporary); } catch {} }
    }
  });

  router.get('/knowledge/:contentId/attachments/:attachmentId', async (req, res, next) => {
    try {
      const attachment = await Promise.resolve(store.getKnowledgeAttachment({
        actorUserId: req.auth.user.id, actorRole: req.auth.user.role,
        documentId: req.params.contentId, attachmentId: req.params.attachmentId
      }));
      const root = path.resolve(attachmentRoot);
      const target = path.resolve(root, ...attachment.storageKey.split('/'));
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw attachmentError('UNSAFE_PATH', 'attachment path is not allowed', 400);
      if (!fs.existsSync(target)) throw attachmentError('CONTENT_NOT_FOUND', 'content was not found', 404);
      res.setHeader('content-type', attachment.mediaType);
      res.setHeader('content-length', String(attachment.sizeBytes));
      res.setHeader('content-disposition', `attachment; filename="${attachment.originalName.replace(/"/g, '')}"`);
      fs.createReadStream(target).on('error', next).pipe(res);
    } catch (error) { next(mapAttachmentError(error)); }
  });

  router.get('/knowledge/:contentId/attachments/:attachmentId/preview', async (req, res, next) => {
    try {
      const attachment = await Promise.resolve(store.getKnowledgeAttachment({
        actorUserId: req.auth.user.id, actorRole: req.auth.user.role,
        documentId: req.params.contentId, attachmentId: req.params.attachmentId
      }));
      const root = path.resolve(attachmentRoot);
      const target = path.resolve(root, ...attachment.storageKey.split('/'));
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw attachmentError('UNSAFE_PATH', 'attachment path is not allowed', 400);
      if (!fs.existsSync(target)) throw attachmentError('CONTENT_NOT_FOUND', 'content was not found', 404);
      const parsed = extractAttachmentText({ originalName: attachment.originalName, content: fs.readFileSync(target) });
      res.json({ attachmentId: attachment.id, format: parsed.format, truncated: parsed.truncated, text: parsed.text });
    } catch (error) { next(mapAttachmentError(error)); }
  });

  router.get('/knowledge/:contentId/export', async (req, res, next) => {
    try {
      const knowledge = await Promise.resolve(store.getKnowledge({
        actorUserId: req.auth.user.id, actorRole: req.auth.user.role,
        documentId: req.params.contentId, includeContent: true
      }));
      const attachments = [];
      let totalBytes = Buffer.byteLength(knowledge.markdown || '', 'utf8');
      for (const listedAttachment of knowledge.attachments || []) {
        const attachment = await Promise.resolve(store.getKnowledgeAttachment({
          actorUserId: req.auth.user.id, actorRole: req.auth.user.role,
          documentId: req.params.contentId, attachmentId: listedAttachment.id
        }));
        const root = path.resolve(attachmentRoot);
        const target = path.resolve(root, ...String(attachment.storageKey || '').split('/'));
        if (target === root || !target.startsWith(`${root}${path.sep}`)) throw attachmentError('UNSAFE_PATH', 'attachment path is not allowed', 400);
        if (!fs.existsSync(target)) throw attachmentError('CONTENT_NOT_FOUND', 'content was not found', 404);
        const content = fs.readFileSync(target);
        totalBytes += content.length;
        if (totalBytes > maxExportBytes) throw attachmentError('ATTACHMENT_EXPORT_TOO_LARGE', 'knowledge export is too large', 413);
        attachments.push({
          id: attachment.id, originalName: attachment.originalName, mediaType: attachment.mediaType,
          sizeBytes: attachment.sizeBytes, contentSha256: attachment.contentSha256,
          createdAt: attachment.createdAt, contentBase64: content.toString('base64')
        });
      }
      const bundle = {
        type: 'knowledge-bundle', schemaVersion: 1,
        knowledge: {
          id: knowledge.id, title: knowledge.title, category: knowledge.category, tags: knowledge.tags,
          status: knowledge.status, visibility: knowledge.visibility, version: knowledge.version,
          markdown: knowledge.markdown, references: knowledge.references || [], versionHistory: knowledge.versionHistory || []
        },
        attachments
      };
      if (requestAuditor) requestAuditor.record(req, {
        action: 'content.knowledge.export', targetType: 'knowledge_document', targetId: knowledge.id,
        metadata: { version: knowledge.version, attachmentCount: attachments.length }
      });
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${safeFileName(`knowledge-${knowledge.id}.json`)}"`);
      res.json(bundle);
    } catch (error) { next(mapAttachmentError(error)); }
  });

  return router;
}

module.exports = { createContentAttachmentRouter };
