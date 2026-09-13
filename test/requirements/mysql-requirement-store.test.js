'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlRequirementStore } = require('../../src/requirements/mysql-requirement-store');
const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

test('persists private requirements and original communication records on MySQL', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 }); await migrateMySqlDatabase(db);
  const suffix = Date.now().toString(36); const owner = `req-owner-${suffix}`, other = `req-other-${suffix}`, admin = `req-admin-${suffix}`;
  t.after(async () => { await db.query('DELETE FROM users WHERE id IN (?, ?, ?)', [owner, other, admin]); await db.close(); });
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at) VALUES
    (?, ?, 'Owner', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, 'Other', 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, 'Admin', 'hash', 'admin', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [owner, `req.owner.${suffix}`, other, `req.other.${suffix}`, admin, `req.admin.${suffix}`]);
  let serial = 0; const store = createMySqlRequirementStore(db, { idFactory: () => `mysql-req-${suffix}-${++serial}`, clock: () => '2026-09-13T00:00:00.000Z' });
  const bu = await store.createBusinessUnit({ actorUserId: admin, actorRole: 'admin', name: `云 BU ${suffix}` });
  const requirement = await store.createRequirement({ ownerUserId: owner, title: '内网迁移', buId: bu.id, scenario: '云迁移', description: '原始需求' }); assert.equal(requirement.responsibleUserId, owner);
  await store.addInteraction({ ownerUserId: owner, requirementId: requirement.id, channel: 'iim', content: 'IIM 原文', occurredAt: '2026-09-13T02:30:00.000Z' });
  await assert.rejects(() => store.getRequirement({ ownerUserId: other, id: requirement.id }), (error) => error.code === 'REQUIREMENT_NOT_FOUND');
  await assert.rejects(() => store.getRequirement({ ownerUserId: admin, id: requirement.id }), (error) => error.code === 'REQUIREMENT_NOT_FOUND');
  const detail = await store.getRequirement({ ownerUserId: owner, id: requirement.id }); assert.equal(detail.interactions[0].content, 'IIM 原文');
  assert.deepEqual((await store.listRequirements({ ownerUserId: owner, query: '迁移' })).items.map((item) => item.id), [requirement.id]);
});
