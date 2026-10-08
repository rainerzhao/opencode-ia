#!/usr/bin/env node
'use strict';

const { writeReleaseManifest, validateReleaseManifest } = require('../src/ops/release-manifest');

function main(argv = process.argv.slice(2)) {
  try {
    const [mode, releaseDir, sha] = argv;
    if (argv.length !== 3 || !['create', 'check'].includes(mode)) throw new Error();
    if (mode === 'create') writeReleaseManifest({ releaseDir, gitSha: sha });
    else validateReleaseManifest({ releaseDir, expectedSha: sha });
    process.stdout.write(JSON.stringify({ valid: true }) + '\n');
    return 0;
  } catch (error) {
    process.stderr.write((error.code === 'RELEASE_MANIFEST_EXISTS' ? error.code : 'RELEASE_MANIFEST_INVALID') + '\n');
    return 1;
  }
}
if (require.main === module) process.exitCode = main();
module.exports = { main };
