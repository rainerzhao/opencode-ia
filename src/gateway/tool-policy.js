'use strict';

const PERMISSION_ACTIONS = new Set(['allow', 'ask', 'deny']);
const FORCED_PERMISSION_DENIES = Object.freeze([
  'external_directory',
  'bash',
  'task',
  'webfetch',
  'websearch'
]);

const WORKSPACE_PROMPT_TOOLS = Object.freeze({
  bash: false,
  task: false,
  webfetch: false,
  websearch: false
});

function invalidConfig() {
  return new TypeError('OpenCode config content is invalid');
}

function forcePermission(permission) {
  if (permission === undefined) permission = {};
  else if (typeof permission === 'string') {
    if (!PERMISSION_ACTIONS.has(permission)) throw invalidConfig();
    permission = { '*': permission };
  } else if (!permission || typeof permission !== 'object' || Array.isArray(permission)) {
    throw invalidConfig();
  } else {
    permission = { ...permission };
  }

  for (const name of FORCED_PERMISSION_DENIES) permission[name] = 'deny';
  return permission;
}

function secureOpenCodeConfigContent(content) {
  let config = {};
  if (content !== undefined && content !== '') {
    if (typeof content !== 'string') throw invalidConfig();
    try {
      config = JSON.parse(content);
    } catch {
      throw invalidConfig();
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw invalidConfig();
  }

  let agents = config.agent;
  if (agents === undefined) agents = {};
  else if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
    throw invalidConfig();
  } else {
    agents = { ...agents };
  }

  for (const [name, agent] of Object.entries(agents)) {
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) throw invalidConfig();
    agents[name] = { ...agent, permission: forcePermission(agent.permission) };
  }
  agents.build = {
    ...(agents.build || {}),
    permission: forcePermission(agents.build?.permission)
  };

  return JSON.stringify({
    ...config,
    permission: forcePermission(config.permission),
    agent: agents
  });
}

module.exports = {
  FORCED_PERMISSION_DENIES,
  WORKSPACE_PROMPT_TOOLS,
  secureOpenCodeConfigContent
};
