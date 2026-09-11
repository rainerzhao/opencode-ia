'use strict';

const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlContentStore } = require('../../src/content/mysql-content-store');
const { createContentRouter } = require('../../src/modules/content/routes');

const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

test('runs the private knowledge HTTP lifecycle against the MySQL Content Store', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  await migrateMySqlDatabase(db);
  const suffix = crypto.randomUUID().slice(0, 8);
  const ownerId = `mysql-content-http-owner-${suffix}`;
  const memberId = `mysql-content-http-member-${suffix}`;
  t.after(async () => {
    await db.query('UPDATE knowledge_documents SET current_version_id = NULL WHERE owner_user_id IN (?, ?)', [ownerId, memberId]);
    await db.query('DELETE FROM knowledge_versions WHERE document_id IN (SELECT id FROM knowledge_documents WHERE owner_user_id IN (?, ?))', [ownerId, memberId]);
    await db.query('DELETE FROM knowledge_documents WHERE owner_user_id IN (?, ?)', [ownerId, memberId]);
    await db.query('DELETE FROM users WHERE id IN (?, ?)', [ownerId, memberId]);
  });
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, 'MySQL HTTP Owner', 'hash', 'member', 'active', '2026-09-11 00:00:00.000', '2026-09-11 00:00:00.000'),
      (?, ?, 'MySQL HTTP Member', 'hash', 'member', 'active', '2026-09-11 00:00:00.000', '2026-09-11 00:00:00.000')`, [
    ownerId, `mysql.http.owner.${suffix}`, memberId, `mysql.http.member.${suffix}`
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { user: { id: req.get('x-test-user'), role: 'member' } };
    next();
  });
  app.use(createContentRouter({
    store: createMySqlContentStore(db), requestAuditor: { record() {} }
  }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code || 'INTERNAL' } }));
  const server = http.createServer(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(async () => db.close());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const create = await fetch(`${baseUrl}/knowledge`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': ownerId },
    body: JSON.stringify({ title: 'MySQL HTTP private knowledge', category: 'runtime', tags: ['mysql'], markdown: '# private' })
  });
  assert.equal(create.status, 201);
  const knowledge = (await create.json()).knowledge;
  const denied = await fetch(`${baseUrl}/knowledge/${knowledge.id}`, { headers: { 'x-test-user': memberId } });
  assert.deepEqual(await denied.json(), { error: { code: 'CONTENT_NOT_FOUND' } });
  const publish = await fetch(`${baseUrl}/knowledge/${knowledge.id}/publish`, {
    method: 'POST', headers: { 'x-test-user': ownerId }
  });
  assert.equal(publish.status, 200);
  await publish.json();
  const visible = await fetch(`${baseUrl}/knowledge/${knowledge.id}`, { headers: { 'x-test-user': memberId } });
  assert.equal(visible.status, 200);
  assert.equal((await visible.json()).knowledge.visibility, 'team');
});
