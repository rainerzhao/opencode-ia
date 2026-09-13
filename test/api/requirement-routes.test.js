'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
let createRequirementRouter;
try { ({ createRequirementRouter } = require('../../src/modules/requirements/routes')); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

function serverFor(store, events) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.auth = { user: { id: req.get('x-user') || 'owner', role: req.get('x-role') || 'member' } }; req.requestId = 'request-1'; next(); });
  app.use(createRequirementRouter({ store, requestAuditor: { record(_req, event) { events.push(event); } }, requireAdmin: (req, _res, next) => req.auth.user.role === 'admin' ? next() : next(Object.assign(new Error('forbidden'), { code: 'FORBIDDEN', status: 403 })) }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code || 'INTERNAL' } }));
  return http.createServer(app);
}

test('requirements API owns creation, hides private detail, and audits metadata without communication body', async (t) => {
  assert.equal(typeof createRequirementRouter, 'function');
  const calls = []; const events = [];
  const store = {
    async listBusinessUnits() { return [{ id: 'bu-1', name: '云 BU', status: 'active' }]; },
    async createRequirement(input) { calls.push(input); return { id: 'req-1', ...input, status: 'draft' }; },
    async getRequirement({ ownerUserId, id }) { if (ownerUserId !== 'owner' || id !== 'req-1') { const error = new Error(); error.code = 'REQUIREMENT_NOT_FOUND'; throw error; } return { id, ownerUserId, interactions: [] }; },
    async listRequirements() { return { items: [], total: 0, limit: 20, offset: 0 }; },
    async updateRequirement() {}, async addInteraction() {}, async createBusinessUnit() {}, async archiveBusinessUnit() {}
  };
  const server = serverFor(store, events); t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const create = await fetch(`${base}/`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'owner' }, body: JSON.stringify({ title: '需求', buId: 'bu-1', description: '正文' }) });
  assert.equal(create.status, 201); assert.equal(calls[0].ownerUserId, 'owner'); assert.equal(calls[0].actorUserId, undefined);
  assert.deepEqual(events[0], { action: 'requirement.create', targetType: 'requirement', targetId: 'req-1', metadata: { buId: 'bu-1', status: 'draft' } });
  const denied = await fetch(`${base}/req-1`, { headers: { 'x-user': 'admin', 'x-role': 'admin' } });
  assert.deepEqual(await denied.json(), { error: { code: 'REQUIREMENT_NOT_FOUND' } });
});

test('requires admin for BU writes and does not put original interaction text into audit metadata', async (t) => {
  const calls = []; const events = [];
  const store = {
    async listBusinessUnits() { return []; }, async listRequirements() { return { items: [], total: 0, limit: 20, offset: 0 }; },
    async createBusinessUnit(input) { calls.push(input); return { id: 'bu-1', name: input.name, status: 'active' }; },
    async archiveBusinessUnit() {}, async createRequirement() {}, async getRequirement() {}, async updateRequirement() {},
    async addInteraction(input) { calls.push(input); return { id: 'int-1', ...input }; }
  };
  const server = serverFor(store, events); t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const denied = await fetch(`${base}/business-units`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '云 BU' }) });
  assert.equal(denied.status, 403);
  const interaction = await fetch(`${base}/req-1/interactions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'owner' }, body: JSON.stringify({ channel: 'phone', content: '不应审计正文', occurredAt: '2026-09-13T02:30:00.000Z' }) });
  assert.equal(interaction.status, 201); assert.equal(calls.at(-1).ownerUserId, 'owner');
  assert.deepEqual(events.at(-1), { action: 'requirement.interaction.create', targetType: 'requirement_interaction', targetId: 'int-1', metadata: { requirementId: 'req-1', channel: 'phone' } });
});

test('adds an owned asset link while auditing only immutable relation metadata', async (t) => {
  const calls = []; const events = []; const store = {
    async listBusinessUnits() { return []; }, async listRequirements() { return { items: [], total: 0, limit: 20, offset: 0 }; }, async createBusinessUnit() {}, async archiveBusinessUnit() {}, async createRequirement() {}, async getRequirement() {}, async updateRequirement() {}, async addInteraction() {}, async removeRequirementLink() {},
    async addRequirementLink(input) { calls.push(input); return { id: 'link-1', requirementId: input.requirementId, resourceType: input.resourceType, resourceId: input.resourceId, versionId: 'version-1' }; }
  };
  const server = serverFor(store, events); t.after(() => new Promise((resolve) => server.close(resolve))); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/req-1/links`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'owner' }, body: JSON.stringify({ resourceType: 'knowledge', resourceId: 'knowledge-1' }) }); assert.equal(response.status, 201); assert.deepEqual(calls[0], { ownerUserId: 'owner', requirementId: 'req-1', resourceType: 'knowledge', resourceId: 'knowledge-1' });
  assert.deepEqual(events[0], { action: 'requirement.link.create', targetType: 'requirement_link', targetId: 'link-1', metadata: { requirementId: 'req-1', resourceType: 'knowledge', resourceId: 'knowledge-1', versionId: 'version-1' } });
});

test('allows only an administrator to govern field templates and never audits private field values', async (t) => {
  const calls = []; const events = []; const store = {
    async listBusinessUnits() { return []; }, async listRequirements() { return { items: [], total: 0, limit: 20, offset: 0 }; }, async createBusinessUnit() {}, async archiveBusinessUnit() {}, async createRequirement(input) { calls.push(input); return { id: 'req-1', ...input, buId: 'bu-1', status: 'draft' }; }, async getRequirement() {}, async updateRequirement() {}, async addInteraction() {}, async addRequirementLink() {}, async removeRequirementLink() {},
    async createFieldTemplate(input) { calls.push(input); return { id: 'field-1', key: input.key, label: input.label, type: input.type, options: input.options || [], required: Boolean(input.required), status: 'active', schemaVersion: 1 }; }, async listFieldTemplates() { return []; }, async updateFieldTemplate() {}, async archiveFieldTemplate() {}
  };
  const server = serverFor(store, events); t.after(() => new Promise((resolve) => server.close(resolve))); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const denied = await fetch(`${base}/field-templates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'priority', label: '优先级', type: 'select', options: ['P0'] }) }); assert.equal(denied.status, 403);
  const created = await fetch(`${base}/field-templates`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-role': 'admin', 'x-user': 'admin' }, body: JSON.stringify({ key: 'priority', label: '优先级', type: 'select', options: ['P0'] }) }); assert.equal(created.status, 201); assert.equal(calls[0].actorUserId, 'admin'); assert.deepEqual(events[0], { action: 'requirement.field_template.create', targetType: 'requirement_field_template', targetId: 'field-1', metadata: { key: 'priority', type: 'select', schemaVersion: 1 } });
  const requirement = await fetch(`${base}/`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'owner' }, body: JSON.stringify({ title: '字段需求', buId: 'bu-1', fieldValues: [{ templateId: 'field-1', value: 'P0' }] }) }); assert.equal(requirement.status, 201); assert.deepEqual(events.at(-1), { action: 'requirement.create', targetType: 'requirement', targetId: 'req-1', metadata: { buId: 'bu-1', status: 'draft' } }); assert.deepEqual(calls.at(-1).fieldValues, [{ templateId: 'field-1', value: 'P0' }]);
});
