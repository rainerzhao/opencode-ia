'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
let input;
try { input = require('../../src/requirements/requirement-input'); } catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('requirement input contract is available', () => {
  assert.equal(typeof input?.normalizeRequirement, 'function');
});

test('normalizes core fields without allowing client controlled ownership or sharing', () => {
  assert.ok(input, 'requirement input contract must exist');
  assert.deepEqual(input.normalizeRequirement({ title: ' 云迁移 ', buId: 'bu-1', description: '第一行\n第二行' }), {
    title: '云迁移', buId: 'bu-1', scenario: '', description: '第一行\n第二行', status: 'draft'
  });
  for (const extra of ['ownerUserId', 'visibility', 'actorUserId', 'id', 'customFields']) {
    assert.throws(() => input.normalizeRequirement({ title: '需求', buId: 'bu-1', [extra]: 'forged' }), { code: 'INVALID_REQUIREMENT_INPUT' });
  }
});

test('rejects invalid required fields and preserves partial update semantics', () => {
  assert.ok(input, 'requirement input contract must exist');
  for (const body of [null, [], {}, { title: '', buId: 'bu-1' }, { title: 'a\nb', buId: 'bu-1' },
    { title: 'x'.repeat(201), buId: 'bu-1' }, { title: 'ok', buId: '../bu' },
    { title: 'ok', buId: 'bu-1', status: 'published' }, { title: 'ok', buId: 'bu-1', description: '\u0000' }]) {
    assert.throws(() => input.normalizeRequirement(body), { code: 'INVALID_REQUIREMENT_INPUT' });
  }
  assert.deepEqual(input.normalizeRequirement({ description: '' }, { patch: true }), { description: '' });
  assert.deepEqual(input.normalizeRequirement({ status: 'archived' }, { patch: true }), { status: 'archived' });
  assert.throws(() => input.normalizeRequirement({}, { patch: true }), { code: 'INVALID_REQUIREMENT_INPUT' });
  assert.throws(() => input.normalizeRequirement({ title: undefined }, { patch: true }), { code: 'INVALID_REQUIREMENT_INPUT' });
});

test('communication retains original notes and requires a real timezone-qualified date', () => {
  assert.ok(input, 'requirement input contract must exist');
  assert.deepEqual(input.normalizeInteraction({ channel: 'phone', content: '  原始记录\n ', occurredAt: '2026-09-13T10:30:00+08:00' }), {
    channel: 'phone', content: '  原始记录\n ', occurredAt: '2026-09-13T02:30:00.000Z'
  });
  for (const occurredAt of ['2026-02-30T10:00:00Z', '2026-09-13', '2026-09-13T10:00:00', '', 123]) {
    assert.throws(() => input.normalizeInteraction({ channel: 'iim', content: 'note', occurredAt }), { code: 'INVALID_REQUIREMENT_INPUT' });
  }
  assert.throws(() => input.normalizeInteraction({ channel: 'ai', content: 'note', occurredAt: '2026-09-13T10:00:00Z' }), { code: 'INVALID_REQUIREMENT_INPUT' });
  assert.throws(() => input.normalizeInteraction({ channel: 'manual', content: '  ', occurredAt: '2026-09-13T10:00:00Z' }), { code: 'INVALID_REQUIREMENT_INPUT' });
});

test('list queries bound pagination and reject array coercion and unknown filters', () => {
  assert.ok(input, 'requirement input contract must exist');
  assert.deepEqual(input.normalizeRequirementQuery({}), { limit: 20, offset: 0, query: '' });
  assert.deepEqual(input.normalizeRequirementQuery({ limit: '50', offset: '20', q: ' 云 ', buId: 'bu-1', status: 'resolved' }), {
    limit: 50, offset: 20, query: '云', buId: 'bu-1', status: 'resolved'
  });
  for (const query of [{ limit: '101' }, { offset: '-1' }, { limit: ['2'] }, { limit: '2e1' },
    { q: ['private'] }, { ownerUserId: 'other' }, { status: 'invalid' }, { offset: '1000001' }]) {
    assert.throws(() => input.normalizeRequirementQuery(query), { code: 'INVALID_REQUIREMENT_INPUT' });
  }
});
