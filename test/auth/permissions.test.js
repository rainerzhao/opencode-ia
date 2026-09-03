'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { can } = require('../../src/auth/permissions');

const admin = { id: 'admin-1', role: 'admin', status: 'active' };
const memberA = { id: 'member-a', role: 'member', status: 'active' };
const memberB = { id: 'member-b', role: 'member', status: 'active' };

test('allows active users to use the workbench but reserves administration for admins', () => {
  assert.equal(can(memberA, 'workbench:use'), true);
  assert.equal(can(admin, 'workbench:use'), true);
  assert.equal(can(memberA, 'sessions:list'), false);
  assert.equal(can(admin, 'sessions:list'), true);
  assert.equal(can({ ...admin, status: 'disabled' }, 'sessions:list'), false);
  assert.equal(can(null, 'workbench:use'), false);
});

test('limits private resources to the owner while allowing explicit admin management', () => {
  const privateResource = { ownerUserId: memberA.id, visibility: 'private' };
  const sharedResource = { ownerUserId: memberA.id, visibility: 'shared' };

  assert.equal(can(memberA, 'resource:read', privateResource), true);
  assert.equal(can(memberB, 'resource:read', privateResource), false);
  assert.equal(can(admin, 'resource:manage', privateResource), true);
  assert.equal(can(memberB, 'resource:read', sharedResource), true);
  assert.equal(can(memberA, 'resource:write', privateResource), true);
  assert.equal(can(memberB, 'resource:write', privateResource), false);
  assert.equal(can(memberA, 'resource:delete-permanently', privateResource), false);
  assert.equal(can(admin, 'resource:delete-permanently', privateResource), true);
});

test('fails closed for malformed users, resources, and unknown actions', () => {
  assert.equal(can({ id: '', role: 'admin', status: 'active' }, 'sessions:list'), false);
  assert.equal(can(memberA, 'resource:read', null), false);
  assert.equal(can(memberA, 'unknown:action'), false);
});
