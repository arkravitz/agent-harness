import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig, resolveProvider, updateConfig } from '../server/settings.mjs';

function tempConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-settings-'));
  return { dir, config: loadConfig(dir) };
}

test('auto mode falls back to demo with no credentials', () => {
  const { dir, config } = tempConfig();
  try {
    const provider = resolveProvider(config, {});
    assert.equal(provider.name, 'demo');
    assert.match(provider.warning, /No model credentials/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('auto mode prefers an Anthropic environment key', () => {
  const { dir, config } = tempConfig();
  try {
    const provider = resolveProvider(config, { ANTHROPIC_API_KEY: 'sk-ant-test' });
    assert.equal(provider.name, 'anthropic');
    assert.equal(provider.apiKey, 'sk-ant-test');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('auto mode uses the DeepSeek preset when that key is present', () => {
  const { dir, config } = tempConfig();
  try {
    const provider = resolveProvider(config, { DEEPSEEK_API_KEY: 'ds-test' });
    assert.equal(provider.name, 'openai');
    assert.equal(provider.model, 'deepseek-chat');
    assert.match(provider.baseUrl, /deepseek/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a selected provider without a key falls back to demo with a warning', () => {
  const { dir, config } = tempConfig();
  try {
    const selected = updateConfig(config, { provider: 'openai' });
    const provider = resolveProvider(selected, {});
    assert.equal(provider.name, 'demo');
    assert.match(provider.warning, /no API key/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a local OpenAI-compatible endpoint works without a key', () => {
  const { dir, config } = tempConfig();
  try {
    const selected = updateConfig(config, {
      provider: 'openai',
      openai: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen' }
    });
    const provider = resolveProvider(selected, {});
    assert.equal(provider.name, 'openai');
    assert.equal(provider.model, 'qwen');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
