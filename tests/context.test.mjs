import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildMessages, buildSystemContext } from '../server/context.mjs';
import { Store } from '../server/store.mjs';
import { loadConfig } from '../server/settings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-context-'));
  for (const entry of ['AGENTS.md', 'prompts', 'skills']) {
    fs.cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true });
  }
  return dir;
}

test('system context includes workspace, project, docs, memory, and skill', () => {
  const root = workspace();
  const store = new Store(path.join(root, 'data'), { seed: false });
  try {
    const project = store.createProject({
      name: 'Research desk',
      description: 'A test project',
      instructions: 'Always cite the primary source.'
    });
    store.addDocument(project.id, {
      name: 'Style.md',
      content: 'Short paragraphs. No corporate filler.'
    });
    store.addMemory({ content: 'The user runs a newsletter.', category: 'project' });
    const config = loadConfig(path.join(root, 'data'));

    const context = buildSystemContext({
      store,
      config,
      workspaceRoot: root,
      projectId: project.id,
      skillId: 'ai-news-brief',
      thinking: true
    });

    assert.match(context.stable, /local-first AI assistant/);
    assert.match(context.stable, /artifact="Short title"/);
    assert.match(context.stable, /<memory category="fact">/);
    assert.doesNotMatch(context.stable, /Research desk/);
    assert.match(context.dynamic, /Research desk/);
    assert.match(context.dynamic, /Always cite the primary source/);
    assert.match(context.dynamic, /Style\.md/);
    assert.match(context.dynamic, /No corporate filler/);
    assert.match(context.dynamic, /The user runs a newsletter/);
    assert.match(context.dynamic, /Active skill: AI news brief/);
    assert.match(context.dynamic, /Pick five items/);
    assert.match(context.dynamic, /Extended thinking is enabled/);
    assert.match(context.dynamic, /Agent Harness workspace/);
    assert.ok(context.system.length > 3000);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('memory can be disabled without hiding the rest of the context', () => {
  const root = workspace();
  const store = new Store(path.join(root, 'data'), { seed: false });
  try {
    store.addMemory({ content: 'A secret preference.', category: 'preference' });
    const config = { ...loadConfig(path.join(root, 'data')), memoryEnabled: false };
    const context = buildSystemContext({ store, config, workspaceRoot: root });
    assert.doesNotMatch(context.dynamic, /A secret preference/);
    assert.match(context.dynamic, /No project is selected/);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('conversation history is ordered and starts with a user message', () => {
  const root = workspace();
  const store = new Store(path.join(root, 'data'), { seed: false });
  try {
    const conversation = store.createConversation({});
    store.addMessage({ conversationId: conversation.id, role: 'assistant', content: 'orphan' });
    store.addMessage({ conversationId: conversation.id, role: 'user', content: 'hello' });
    store.addMessage({ conversationId: conversation.id, role: 'assistant', content: 'hi' });
    const messages = buildMessages(store, conversation);
    assert.deepEqual(messages, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' }
    ]);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scheduled task prompt is appended as a user message', () => {
  const root = workspace();
  const store = new Store(path.join(root, 'data'), { seed: false });
  try {
    const messages = buildMessages(store, null, { extraUserPrompt: 'Write the brief.' });
    assert.deepEqual(messages, [{ role: 'user', content: 'Write the brief.' }]);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
