'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { extractAttachmentText } = require('../../content/attachment-parser');

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
  }
  return error;
}

function createContentAttachmentRouter({ store, uploadMiddleware, attachmentRoot, safeFileName, ensurePrivateDirectory }) {
  if (!store || typeof store.createKnowledgeAttachment !== 'function' || typeof uploadMiddleware !== 'function' ||
    !attachmentRoot || typeof safeFileName !== 'function' || typeof ensurePrivateDirectory !== 'function') {
    throw new TypeError('content attachment route dependencies are required');
  }
  const router = express.Router();
  const allowedExtensions = new Set(['.md', '.txt', '.docx', '.pdf', '.json', '.csv']);

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

  return router;
}

module.exports = { createContentAttachmentRouter };
