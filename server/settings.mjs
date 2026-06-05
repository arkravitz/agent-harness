import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  harnessName: 'Agent Harness',
  provider: 'auto',
  memoryEnabled: true,
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: ''
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    apiKey: ''
  }
};

function merge(base, patch) {
  const next = { ...base, ...patch };
  for (const key of ['openai', 'anthropic']) {
    next[key] = { ...base[key], ...(patch?.[key] || {}) };
  }
  return next;
}

export function configPath(dataDir) {
  return path.join(dataDir, 'config.json');
}

export function loadConfig(dataDir) {
  const file = configPath(dataDir);
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[config] Could not read ${file}: ${error.message}`);
    }
  }
  return merge(DEFAULTS, stored);
}

export function saveConfig(dataDir, config) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = configPath(dataDir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
}

function isLocalEndpoint(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Turn the saved config plus environment into the provider the server will
 * actually use. A selected provider with no usable credentials falls back to
 * demo mode with a visible warning rather than failing every chat.
 */
export function resolveProvider(config, env = process.env) {
  const selected = ['auto', 'demo', 'openai', 'anthropic'].includes(config.provider)
    ? config.provider
    : 'auto';

  const openaiConfig = {
    ...config.openai,
    apiKey: config.openai.apiKey || env.OPENAI_API_KEY || '',
    baseUrl: env.OPENAI_BASE_URL || config.openai.baseUrl || DEFAULTS.openai.baseUrl,
    model: env.OPENAI_MODEL || config.openai.model || DEFAULTS.openai.model
  };

  const anthropicConfig = {
    ...config.anthropic,
    apiKey: config.anthropic.apiKey || env.ANTHROPIC_API_KEY || '',
    baseUrl: env.ANTHROPIC_BASE_URL || config.anthropic.baseUrl || DEFAULTS.anthropic.baseUrl,
    model: env.ANTHROPIC_MODEL || config.anthropic.model || DEFAULTS.anthropic.model
  };

  if (selected === 'demo') {
    return { name: 'demo', model: 'offline demo', baseUrl: null, apiKey: '', warning: null };
  }

  if (selected === 'openai') {
    if (!openaiConfig.apiKey && !isLocalEndpoint(openaiConfig.baseUrl)) {
      return {
        name: 'demo',
        model: 'offline demo',
        baseUrl: null,
        apiKey: '',
        warning: 'OpenAI-compatible provider selected, but no API key is saved. Running offline demo mode.'
      };
    }
    return { name: 'openai', ...openaiConfig, warning: null };
  }

  if (selected === 'anthropic') {
    if (!anthropicConfig.apiKey) {
      return {
        name: 'demo',
        model: 'offline demo',
        baseUrl: null,
        apiKey: '',
        warning: 'Anthropic selected, but no API key is saved. Running offline demo mode.'
      };
    }
    return { name: 'anthropic', ...anthropicConfig, warning: null };
  }

  // auto: prefer a saved provider key, then environment presets, then demo.
  if (anthropicConfig.apiKey) {
    return { name: 'anthropic', ...anthropicConfig, warning: null };
  }
  if (openaiConfig.apiKey) {
    return { name: 'openai', ...openaiConfig, warning: null };
  }
  if (env.DEEPSEEK_API_KEY) {
    return {
      name: 'openai',
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      warning: null
    };
  }
  if (isLocalEndpoint(openaiConfig.baseUrl) && env.OPENAI_MODEL) {
    return { name: 'openai', ...openaiConfig, warning: null };
  }
  return {
    name: 'demo',
    model: 'offline demo',
    baseUrl: null,
    apiKey: '',
    warning: 'No model credentials found. Running offline demo mode. Add a key in Settings.'
  };
}

export function publicSettings(config) {
  const provider = resolveProvider(config);
  return {
    harnessName: config.harnessName,
    provider: config.provider,
    memoryEnabled: config.memoryEnabled,
    openai: {
      baseUrl: config.openai.baseUrl,
      model: config.openai.model,
      hasKey: Boolean(config.openai.apiKey || process.env.OPENAI_API_KEY),
      envKey: Boolean(process.env.OPENAI_API_KEY && !config.openai.apiKey)
    },
    anthropic: {
      baseUrl: config.anthropic.baseUrl,
      model: config.anthropic.model,
      hasKey: Boolean(config.anthropic.apiKey || process.env.ANTHROPIC_API_KEY),
      envKey: Boolean(process.env.ANTHROPIC_API_KEY && !config.anthropic.apiKey)
    },
    effective: {
      name: provider.name,
      model: provider.model,
      warning: provider.warning
    },
    envProvider: process.env.HARNESS_PROVIDER || null
  };
}

export function updateConfig(config, body) {
  const next = merge(DEFAULTS, config);
  if (body.harnessName !== undefined) {
    next.harnessName = String(body.harnessName).trim().slice(0, 60) || DEFAULTS.harnessName;
  }
  if (body.provider !== undefined) {
    if (!['auto', 'demo', 'openai', 'anthropic'].includes(body.provider)) {
      throw new Error('Unknown provider.');
    }
    next.provider = body.provider;
  }
  if (body.memoryEnabled !== undefined) {
    next.memoryEnabled = Boolean(body.memoryEnabled);
  }
  for (const name of ['openai', 'anthropic']) {
    const patch = body[name];
    if (!patch || typeof patch !== 'object') continue;
    if (patch.baseUrl !== undefined) {
      const value = String(patch.baseUrl).trim().slice(0, 500);
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error(`${name}.baseUrl must be a valid URL.`);
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`${name}.baseUrl must be http or https.`);
      }
      next[name].baseUrl = value.replace(/\/+$/, '');
    }
    if (patch.model !== undefined) {
      next[name].model = String(patch.model).trim().slice(0, 120);
    }
    if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
      next[name].apiKey = patch.apiKey.trim().slice(0, 500);
    }
    if (patch.clearKey) next[name].apiKey = '';
  }
  return next;
}

export function maskKey(key) {
  if (!key) return null;
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}
