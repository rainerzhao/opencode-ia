'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlRequirementStore } = require('../../src/requirements/mysql-requirement-store');
const { createRequirementRouter } = require('../../src/modules/requirements/routes');
const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

test('serves private requirement lifecycle through HTTP backed by MySQL', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 }); await migrateMySqlDatabase(db);
  const suffix = crypto.randomUUID().slice(0, 8); const owner = `req-http-owner-${suffix}`, other = `req-http-other-${suffix}`, admin = `req-http-admin-${suffix}`;
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { const id = req.get('x-user'); req.auth = { user: { id, role: id === admin ? 'admin' : 'member' } }; req.requestId = 'mysql-http'; next(); });
  app.use(createRequirementRouter({ store: createMySqlRequirementStore(db), requestAuditor: { record() {} }, requireAdmin: (req, _res, next) => req.auth.user.role === 'admin' ? next() : next(Object.assign(new Error('forbidden'), { code: 'FORBIDDEN', status: 403 })) }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code || 'INTERNAL' } }));
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await db.query('DELETE FROM users WHERE id IN (?, ?, ?)', [owner, other, admin]); await db.close(); });
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at) VALUES
    (?, ?, 'Owner', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, 'Other', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, 'Admin', 'hash', 'admin', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [owner, `req.http.owner.${suffix}`, other, `req.http.other.${suffix}`, admin, `req.http.admin.${suffix}`]);
  const buResponse = await fetch(`${base}/business-units`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': admin }, body: JSON.stringify({ name: `HTTP 云 BU ${suffix}` }) }); assert.equal(buResponse.status, 201); const bu = (await buResponse.json()).businessUnit;
  const created = await fetch(`${base}/`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': owner }, body: JSON.stringify({ title: '私有 GPU 容量需求', buId: bu.id, description: '需要评估' }) }); assert.equal(created.status, 201); const requirement = (await created.json()).requirement;
  const interaction = await fetch(`${base}/${requirement.id}/interactions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': owner }, body: JSON.stringify({ channel: 'iim', content: '原始 IIM 纪要', occurredAt: '2026-09-13T02:30:00.000Z' }) }); assert.equal(interaction.status, 201);
  const denied = await fetch(`${base}/${requirement.id}`, { headers: { 'x-user': other } }); assert.equal(denied.status, 404); assert.deepEqual(await denied.json(), { error: { code: 'REQUIREMENT_NOT_FOUND' } });
  const detail = await fetch(`${base}/${requirement.id}`, { headers: { 'x-user': owner } }); assert.equal((await detail.json()).requirement.interactions[0].content, '原始 IIM 纪要');
});
