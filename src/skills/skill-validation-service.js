'use strict';

const { validateSkillPackage } = require('./skill-validator');

function safeRuntimeResult(value) {
  const status = value?.status === 'passed' ? 'passed' : 'failed';
  const result = { status, provider: 'opencode-gateway' };
  if (Number.isInteger(value?.durationMs) && value.durationMs >= 0 && value.durationMs <= 3_600_000) {
    result.durationMs = value.durationMs;
  }
  if (typeof value?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)) {
    result.code = value.code;
  }
  return result;
}

function createSkillValidationService({
  store,
  validator = validateSkillPackage,
  runtimeValidator = null
}) {
  if (!store || typeof store.getValidationCandidate !== 'function' ||
      typeof store.saveValidationReport !== 'function') {
    throw new TypeError('skill validation store is required');
  }
  if (typeof validator !== 'function') throw new TypeError('skill validator is required');
  if (runtimeValidator !== null && typeof runtimeValidator?.validate !== 'function') {
    throw new TypeError('skill runtime validator is invalid');
  }

  async function validate({ actor, id }) {
    const candidate = store.getValidationCandidate({ actor, id });
    const staticReport = validator({
      slug: candidate.slug,
      skillMd: candidate.version.skillMd,
      files: candidate.files.map((file) => ({ path: file.path, content: file.content }))
    });
    let runtime;
    if (staticReport.verdict !== 'pass') {
      runtime = {
        status: 'skipped',
        provider: 'opencode-gateway',
        code: 'STATIC_VALIDATION_FAILED'
      };
    } else if (!runtimeValidator) {
      runtime = {
        status: 'unavailable',
        provider: 'opencode-gateway',
        code: 'RUNTIME_VALIDATOR_UNAVAILABLE'
      };
    } else {
      try {
        runtime = safeRuntimeResult(await runtimeValidator.validate({
          skillId: candidate.id,
          versionId: candidate.version.id,
          ownerUserId: candidate.ownerUserId,
          slug: candidate.slug,
          skillMd: candidate.version.skillMd,
          files: candidate.files.map((file) => ({ path: file.path, content: file.content })),
          contentSha256: candidate.version.contentSha256
        }));
      } catch (error) {
        runtime = safeRuntimeResult({ status: 'failed', code: error?.code || 'RUNTIME_VALIDATION_FAILED' });
      }
    }
    const report = {
      ...staticReport,
      verdict: staticReport.verdict === 'pass' && runtime.status === 'passed' ? 'pass' : 'fail',
      runtime
    };
    return store.saveValidationReport({
      actor,
      id,
      expectedContentSha256: candidate.version.contentSha256,
      report
    });
  }

  return { validate };
}

module.exports = { createSkillValidationService };
