'use strict';

const express = require('express');
const fs = require('node:fs');

function createLegacySolutionsRouter({ solutionsDir, safePath, safeFileName, ensurePrivateDirectory, writePrivateFile, can, requestAuditor }) {
  if (!solutionsDir || typeof safePath !== 'function' || typeof safeFileName !== 'function' ||
    typeof ensurePrivateDirectory !== 'function' || typeof writePrivateFile !== 'function' ||
    typeof can !== 'function' || !requestAuditor) {
    throw new TypeError('legacy solutions route dependencies are required');
  }
  const router = express.Router();

  router.post('/', (req, res) => {
    const { title, description, solution, platforms, skills, chatHistory } = req.body;
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title, description, solution, platforms: platforms || [], skills: skills || [], chatHistory: chatHistory || [],
      createdAt: new Date().toISOString(), createdBy: req.auth.user.id, visibility: 'private'
    };
    if (!fs.existsSync(solutionsDir)) ensurePrivateDirectory(solutionsDir);
    const filePath = safePath(solutionsDir, `${safeFileName(record.id)}.json`, { extensions: ['.json'] });
    writePrivateFile(filePath, JSON.stringify(record, null, 2));
    requestAuditor.record(req, { action: 'solution.create', targetType: 'legacy_solution', targetId: record.id, metadata: { visibility: record.visibility } });
    res.json({ success: true, id: record.id });
  });

  router.get('/', (req, res) => {
    try {
      if (!fs.existsSync(solutionsDir)) return res.json([]);
      const files = fs.readdirSync(solutionsDir).filter((file) => file.endsWith('.json')).map((file) => {
        const content = fs.readFileSync(safePath(solutionsDir, safeFileName(file), { extensions: ['.json'] }), 'utf-8');
        return JSON.parse(content);
      }).filter((record) => can(req.auth.user, 'resource:read', {
        ownerUserId: record.createdBy,
        visibility: record.visibility === 'shared' ? 'shared' : 'private'
      })).sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
      res.json(files);
    } catch {
      res.json([]);
    }
  });

  return router;
}

module.exports = { createLegacySolutionsRouter };
