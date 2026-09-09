'use strict';

function createOpenCodeSkillRuntimeValidator({ gatewayService }) {
  if (!gatewayService || typeof gatewayService.validateSkillPackage !== 'function') {
    throw new TypeError('OpenCode Gateway Skill validator is required');
  }
  return {
    validate(input) {
      return gatewayService.validateSkillPackage(input);
    }
  };
}

module.exports = { createOpenCodeSkillRuntimeValidator };
