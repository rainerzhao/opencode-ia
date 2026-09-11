'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMySqlDatabase } = require('../../src/db/mysql-database');
const { migrateMySqlDatabase } = require('../../src/db/mysql-migrate');
const { createMySqlSkillStore } = require('../../src/skills/mysql-skill-store');
const { createSkillInstallationFiles } = require('../../src/skills/skill-installation-files');
const { createSkillInstallationService } = require('../../src/skills/skill-installation-service');
const { createSkillRouter } = require('../../src/modules/skills/routes');

const testUrl = process.env.WORKBENCH_TEST_MYSQL_URL;

test('persists private Skill drafts and independent member installations on MySQL', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  t.after(async () => db.close());
  await migrateMySqlDatabase(db);
  await db.query(`DELETE f FROM skill_files f JOIN skill_versions v ON v.id = f.version_id
    JOIN skills s ON s.id = v.skill_id WHERE s.owner_user_id IN ('mysql-skill-owner', 'mysql-skill-member')`);
  await db.query(`DELETE i FROM skill_installations i JOIN skills s ON s.id = i.skill_id
    WHERE s.owner_user_id IN ('mysql-skill-owner', 'mysql-skill-member') OR i.user_id IN ('mysql-skill-owner', 'mysql-skill-member')`);
  await db.query("DELETE FROM skill_versions WHERE skill_id IN (SELECT id FROM skills WHERE owner_user_id IN ('mysql-skill-owner', 'mysql-skill-member'))");
  await db.query("DELETE FROM skills WHERE owner_user_id IN ('mysql-skill-owner', 'mysql-skill-member')");
  await db.query("DELETE FROM users WHERE username IN ('mysql.skill.owner', 'mysql.skill.member')");
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
    VALUES ('mysql-skill-owner', 'mysql.skill.owner', 'MySQL Skill Owner', 'hash', 'member', 'active', '2026-09-11 00:00:00.000', '2026-09-11 00:00:00.000'),
      ('mysql-skill-member', 'mysql.skill.member', 'MySQL Skill Member', 'hash', 'member', 'active', '2026-09-11 00:00:00.000', '2026-09-11 00:00:00.000')`);
  const store = createMySqlSkillStore(db, {
    idFactory: (() => { let next = 0; return () => `mysql-skill-${++next}`; })(),
    clock: () => '2026-09-11T00:00:00.000Z'
  });
  const owner = { id: 'mysql-skill-owner', role: 'member' };
  const member = { id: 'mysql-skill-member', role: 'member' };
  const skill = await store.createDraft({
    actor: owner, slug: 'mysql-private-skill', displayName: 'MySQL private Skill',
    skillMd: '---\nname: mysql-private-skill\ndescription: MySQL Skill\n---\n\n# Instructions\n'
  });
  const packaged = await store.replaceDraftFiles({
    actor: owner,
    id: skill.id,
    files: [{ path: 'references/checklist.md', content: '# Checklist\n' }]
  });
  assert.deepEqual(packaged.files.map((file) => file.path), ['references/checklist.md']);
  assert.notEqual(packaged.version.contentSha256, skill.version.contentSha256);
  const edited = await store.updateDraft({ actor: owner, id: skill.id, skillMd: '---\nname: mysql-private-skill\ndescription: MySQL Skill\n---\n\n# Revised\n' });
  assert.notEqual(edited.version.contentSha256, packaged.version.contentSha256);
  assert.equal((await store.getValidationCandidate({ actor: owner, id: skill.id })).version.id, edited.version.id);
  assert.equal(await store.getVisible({ actor: member, id: skill.id }), null);
  const validated = await store.saveValidationReport({
    actor: owner, id: skill.id, expectedContentSha256: edited.version.contentSha256,
    report: { verdict: 'pass', contentSha256: edited.version.contentSha256, summary: { errors: 0, warnings: 0 }, checks: [], runtime: { status: 'passed' } }
  });
  const published = await store.publishValidated({ actor: owner, id: skill.id });
  assert.equal(published.status, 'published');
  assert.equal((await store.listVisible({ actor: member, status: 'published' }))[0].versionStatus, 'published');
  assert.equal((await store.getPublishedInstallCandidate({ actor: member, id: skill.id })).version.id, published.version.id);
  assert.equal((await store.getVisible({ actor: member, id: skill.id })).version.status, 'published');
  const installation = await store.recordInstallation({ actor: member, skillId: skill.id, versionId: validated.version.id });
  assert.equal(installation.status, 'installed');
  assert.equal((await store.setInstallationStatus({ actor: member, skillId: skill.id, status: 'enabled' })).status, 'enabled');
  assert.equal((await store.listEnabledInstallations({ userId: member.id }))[0].skillId, skill.id);
  assert.equal((await store.getInstalledEnableCandidate({ actor: member, id: skill.id, versionId: published.version.id })).id, skill.id);

  const successor = await store.createSuccessorDraft({ actor: owner, id: skill.id });
  assert.equal(successor.version.version, '0.2.0');
  assert.deepEqual(successor.files.map((file) => file.path), ['references/checklist.md']);
  const secondValidated = await store.saveValidationReport({
    actor: owner, id: skill.id, expectedContentSha256: successor.version.contentSha256,
    report: { verdict: 'pass', contentSha256: successor.version.contentSha256, summary: { errors: 0, warnings: 0 }, checks: [], runtime: { status: 'passed' } }
  });
  const secondPublished = await store.publishValidated({ actor: owner, id: skill.id });
  const upgraded = await store.selectInstallationVersion({
    actor: member, skillId: skill.id, versionId: secondPublished.version.id, operation: 'upgrade'
  });
  assert.equal(upgraded.status, 'installed');
  const rolledBack = await store.selectInstallationVersion({
    actor: member, skillId: skill.id, versionId: validated.version.id, operation: 'rollback'
  });
  assert.equal(rolledBack.versionId, validated.version.id);
  await store.setInstallationStatus({ actor: member, skillId: skill.id, status: 'enabled' });
  assert.equal((await store.disableTeamSkill({ actor: owner, id: skill.id })).status, 'disabled');
  assert.equal((await store.listInstallations({ actor: member }))[0].status, 'disabled');
  assert.equal((await store.archiveTeamSkill({ actor: owner, id: skill.id })).status, 'archived');
});

test('serves private Skill creation, validation, publication and member installation through async MySQL HTTP routes', { skip: !testUrl }, async (t) => {
  const db = await createMySqlDatabase({ url: testUrl, poolSize: 2 });
  await migrateMySqlDatabase(db);
  const suffix = `mysql-http-${Date.now()}`;
  const ownerId = `${suffix}-owner`; const memberId = `${suffix}-member`;
  t.after(async () => {
    await db.query('DELETE FROM skill_installations WHERE user_id IN (?, ?)', [ownerId, memberId]);
    await db.query('DELETE FROM skill_files WHERE version_id IN (SELECT id FROM skill_versions WHERE skill_id IN (SELECT id FROM skills WHERE owner_user_id IN (?, ?)))', [ownerId, memberId]);
    await db.query('DELETE FROM skill_versions WHERE skill_id IN (SELECT id FROM skills WHERE owner_user_id IN (?, ?))', [ownerId, memberId]);
    await db.query('DELETE FROM skills WHERE owner_user_id IN (?, ?)', [ownerId, memberId]);
    await db.query('DELETE FROM users WHERE id IN (?, ?)', [ownerId, memberId]);
  });
  await db.query(`INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)), (?, ?, ?, 'hash', 'member', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [ownerId, `${suffix}.owner`, 'Owner', memberId, `${suffix}.member`, 'Member']);
  const store = createMySqlSkillStore(db);
  const installationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mysql-skill-http-'));
  t.after(() => fs.rmSync(installationRoot, { recursive: true, force: true }));
  const installationFiles = createSkillInstallationFiles({ root: installationRoot });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.auth = { user: { id: req.get('x-test-user'), role: 'member' } }; next(); });
  app.use(createSkillRouter({
    store,
    requestAuditor: { record() {} },
    validationService: { async validate({ actor, id }) { const candidate = await store.getValidationCandidate({ actor, id }); return store.saveValidationReport({ actor, id, expectedContentSha256: candidate.version.contentSha256, report: { verdict: 'pass', contentSha256: candidate.version.contentSha256, summary: { errors: 0, warnings: 0 }, checks: [], runtime: { status: 'passed' } } }); } },
    installationService: createSkillInstallationService({
      store,
      installationFiles,
      runtimeValidator: { async validate() { return { status: 'passed' }; } }
    })
  }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code || 'INTERNAL' } }));
  const server = http.createServer(app); t.after(() => new Promise((resolve) => server.close(resolve))); t.after(async () => db.close()); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = await fetch(`${base}/`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': ownerId }, body: JSON.stringify({ slug: `${suffix}-skill`, displayName: 'HTTP Skill', skillMd: '---\nname: http-skill\ndescription: HTTP Skill\n---\n\n# Instructions\n' }) });
  const createdBody = await created.json(); assert.equal(created.status, 201, JSON.stringify(createdBody)); const skill = createdBody.skill;
  const validated = await fetch(`${base}/${skill.id}/validate`, { method: 'POST', headers: { 'x-test-user': ownerId } }); const validatedBody = await validated.json(); assert.equal(validated.status, 200, JSON.stringify(validatedBody));
  const published = await fetch(`${base}/${skill.id}/publish`, { method: 'POST', headers: { 'x-test-user': ownerId } }); const publishedBody = await published.json(); assert.equal(published.status, 200, JSON.stringify(publishedBody));
  const visible = await fetch(`${base}/${skill.id}`, { headers: { 'x-test-user': memberId } }); const visibleBody = await visible.json(); assert.equal(visible.status, 200, JSON.stringify(visibleBody)); assert.equal(visibleBody.skill.visibility, 'team');
  const privateDraft = await fetch(`${base}/`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': ownerId }, body: JSON.stringify({ slug: `${suffix}-private`, displayName: 'Private HTTP Skill', skillMd: '# private' }) }); const privateBody = await privateDraft.json(); assert.equal(privateDraft.status, 201, JSON.stringify(privateBody));
  const denied = await fetch(`${base}/${privateBody.skill.id}`, { headers: { 'x-test-user': memberId } }); assert.equal(denied.status, 404); assert.deepEqual(await denied.json(), { error: { code: 'SKILL_NOT_FOUND' } });
  const installed = await fetch(`${base}/${skill.id}/install`, { method: 'POST', headers: { 'x-test-user': memberId } }); const installedBody = await installed.json(); assert.equal(installed.status, 200, JSON.stringify(installedBody)); assert.equal(installedBody.installation.status, 'installed');
  const enabled = await fetch(`${base}/${skill.id}/enable`, { method: 'POST', headers: { 'x-test-user': memberId } }); const enabledBody = await enabled.json(); assert.equal(enabled.status, 200, JSON.stringify(enabledBody)); assert.equal(enabledBody.installation.status, 'enabled');
  const installations = await fetch(`${base}/installations`, { headers: { 'x-test-user': memberId } }); const installationsBody = await installations.json(); assert.equal(installations.status, 200, JSON.stringify(installationsBody)); assert.equal(installationsBody.installations[0].status, 'enabled');
});
