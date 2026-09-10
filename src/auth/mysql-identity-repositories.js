'use strict';

const { createMySqlUserStore } = require('../users/mysql-user-store');
const { createMySqlSessionStore } = require('../sessions/mysql-session-store');
const { createMySqlAuditStore } = require('../audit/mysql-audit-store');

function createMySqlIdentityRepositories(db) {
  return Object.freeze({
    userStore: createMySqlUserStore(db),
    sessionStore: createMySqlSessionStore(db),
    auditStore: createMySqlAuditStore(db)
  });
}

module.exports = { createMySqlIdentityRepositories };
