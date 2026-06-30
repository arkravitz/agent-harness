import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-api-'));
  for (const entry of ['AGENTS.md', 'prompts', 'skills', 'public']) {
    fs.cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true });
  }
  return dir;
}

test('HTTP API: projects, chat streaming, artifacts, memory, tasks, settings', async () => {
  const root = makeWorkspace();
  const dataDir = path.join(root, 'data');
  const app = createApp({
    workspaceRoot: root,
    dataDir,
    seed: false,
    startScheduler: false,
    demoFast: true,
    logger: { log() {}, error() {} }
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const request = async (pathname, options = {}) => {
    const response = await fetch(base + pathname, {
      method: options.method || 'GET',
      headers: options.body ? { 'content-type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  };

  try {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);

    const state = await request('/api/state');
    assert.equal(state.data.provider.name, 'demo');
    assert.equal(state.data.counts.skills, 4);

    const projectResponse = await request('/api/projects', {
      method: 'POST',
      body: { name: 'Research desk', description: 'Testing', instructions: 'Cite sources.' }
    });
    assert.equal(projectResponse.status, 201);
    const project = projectResponse.data.project;

    const documentResponse = await request(`/api/projects/${project.id}/documents`, {
      method: 'POST',
      body: { name: 'Style.md', content: 'Short paragraphs, no filler.' }
    });
    assert.equal(documentResponse.status, 201);

    const preview = await request('/api/context/preview', {
      method: 'POST',
      body: { projectId: project.id }
    });
    assert.match(preview.data.system, /Cite sources/);
    assert.match(preview.data.system, /Short paragraphs, no filler/);

    const conversationResponse = await request('/api/conversations', {
      method: 'POST',
      body: { projectId: project.id }
    });
    const conversation = conversationResponse.data.conversation;

    const chatResponse = await fetch(`${base}/api/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Build a habit tracker with a 7-day streak and localStorage.' })
    });
    assert.equal(chatResponse.status, 200);
    const stream = await chatResponse.text();
    assert.match(stream, /event: start/);
    assert.match(stream, /event: text/);
    assert.match(stream, /event: artifact/);
    assert.match(stream, /event: done/);
    const doneMatch = stream.match(/event: done\ndata: (.*)\n/);
    assert.ok(doneMatch, 'expected a done event');
    const done = JSON.parse(doneMatch[1]);
    assert.equal(done.artifacts.length, 1);
    assert.doesNotMatch(done.message.content, /```html artifact/);

    const detail = await request(`/api/conversations/${conversation.id}`);
    assert.equal(detail.data.messages.length, 2);
    assert.equal(detail.data.messages[0].role, 'user');
    assert.equal(detail.data.messages[1].role, 'assistant');
    assert.equal(detail.data.artifacts.length, 1);
    assert.match(detail.data.conversation.title, /habit tracker/i);

    const artifact = await request(`/api/artifacts/${detail.data.artifacts[0].id}`);
    assert.equal(artifact.data.artifact.kind, 'html');
    assert.match(artifact.data.artifact.content, /Momentum/);
    const download = await fetch(`${base}/api/artifacts/${artifact.data.artifact.id}/download`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /attachment/);

    const memoryChat = await fetch(`${base}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const memoryConversation = (await memoryChat.json()).conversation;
    const memoryStream = await fetch(`${base}/api/conversations/${memoryConversation.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Remember that my name is Ada.' })
    });
    const memoryBody = await memoryStream.text();
    assert.match(memoryBody, /event: memory/);
    const memories = await request('/api/memory');
    assert.ok(memories.data.memories.some((memory) => /Ada/.test(memory.content)));

    const taskResponse = await request('/api/tasks', {
      method: 'POST',
      body: {
        name: 'Morning brief',
        prompt: 'Write a five-item AI news brief. Be direct.',
        scheduleKind: 'daily',
        scheduleValue: { time: '07:30' },
        projectId: project.id
      }
    });
    assert.equal(taskResponse.status, 201);
    const task = taskResponse.data.task;
    assert.ok(task.nextRunAt);

    const runResponse = await request(`/api/tasks/${task.id}/run`, { method: 'POST', body: {} });
    assert.equal(runResponse.status, 200);
    assert.equal(runResponse.data.run.status, 'success');
    assert.match(runResponse.data.run.output, /Morning brief/);
    const runs = await request(`/api/tasks/${task.id}/runs`);
    assert.equal(runs.data.runs.length, 1);
    const outputs = fs.readdirSync(path.join(dataDir, 'outputs'));
    assert.ok(outputs.some((file) => file.startsWith('morning-brief-')));

    const skillCreate = await request('/api/skills', {
      method: 'POST',
      body: { name: 'Test skill', description: 'For tests', instructions: 'Do the test thing.' }
    });
    assert.equal(skillCreate.status, 201);
    const skillId = skillCreate.data.skill.id;
    const skillUpdate = await request(`/api/skills/${skillId}`, {
      method: 'PATCH',
      body: { instructions: 'Do the updated test thing.' }
    });
    assert.match(skillUpdate.data.skill.instructions, /updated/);
    const skillDelete = await request(`/api/skills/${skillId}`, { method: 'DELETE' });
    assert.equal(skillDelete.status, 200);

    const settings = await request('/api/settings', {
      method: 'PATCH',
      body: { provider: 'demo', harnessName: 'Test Harness', memoryEnabled: false }
    });
    assert.equal(settings.status, 200);
    assert.equal(settings.data.settings.harnessName, 'Test Harness');
    assert.equal(settings.data.settings.memoryEnabled, false);
    assert.equal(JSON.stringify(settings.data).includes('apiKey'), false);

    const exportResponse = await request('/api/export');
    assert.equal(exportResponse.status, 200);
    assert.ok(exportResponse.data.projects.length >= 1);
    assert.ok(exportResponse.data.conversations.length >= 1);
    assert.ok(exportResponse.data.conversations[0].messages.length >= 1);

    const staticIndex = await fetch(base + '/');
    assert.equal(staticIndex.status, 200);
    assert.match(await staticIndex.text(), /Agent Harness/);
    const standalone = await fetch(`${base}/artifact/${artifact.data.artifact.id}`);
    assert.equal(standalone.status, 200);
    assert.match(await standalone.text(), /sandboxed/);

    const missing = await request('/api/nope');
    assert.equal(missing.status, 404);
    assert.match(missing.data.error, /Not found/);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
