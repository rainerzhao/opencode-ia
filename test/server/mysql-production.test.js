'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createMySqlProductionWorkbench } = require('../../apps/server');

test('MySQL production composition fails closed when no database URL is configured', async () => {
  await assert.rejects(
    () => createMySqlProductionWorkbench({ env: {}, projectDir: path.resolve(__dirname, '../..') }),
    (error) => error?.code === 'MYSQL_URL_REQUIRED'
  );
});
