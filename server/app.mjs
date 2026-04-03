import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMessages, buildSystemContext } from './context.mjs';
import { collectModel, ProviderError, streamModel, testProvider } from './llm.mjs';
import { computeNextRun, describeSchedule, normalizeSchedule, Scheduler } from './scheduler.mjs';
import {
  loadConfig,
  publicSettings,
  resolveProvider,
  saveConfig,
  updateConfig
} from './settings.mjs';
import { createSkill, deleteSkill, getSkill, listSkills, updateSkill } from './skills.mjs';
import { Store } from './store.mjs';
import { processAssistantText } from './text.mjs';
import {
  HttpError,
  json,
  nowIso,
  optionalString,
  readJson,
  requireString,
  safeFilename,
  slugify
} from './util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(here, '..');
const VERSION = '0.1.0';
const MEMORY_CATEGORIES = new Set(['fact', 'preference', 'project', 'person']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function hostIsLocal(hostHeader) {
  if (!hostHeader) return true;
  const host = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0];
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
}

function sseSend(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function titleFromMessage(content) {
  const singleLine = String(content).replace(/\s+/g, ' ').trim();
  return singleLine.length > 68 ? `${singleLine.slice(0, 67)}…` : singleLine || 'New chat';
}

function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

export function createApp({
  workspaceRoot = DEFAULT_ROOT,
  dataDir = path.join(workspaceRoot, 'data'),
  seed = true,
  startScheduler = true,
  logger = console,
  demoFast = process.env.HARNESS_DEMO_FAST === '1'
} = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const publicDir = path.join(workspaceRoot, 'public');
  const outputsDir = path.join(dataDir, 'outputs');
  fs.mkdirSync(outputsDir, { recursive: true });

  let config = loadConfig(dataDir);
  const store = new Store(dataDir, { seed });
  const activeChats = new Set();
  const activeTasks = new Set();

  function provider() {
    return resolveProvider(config);
  }

  function projectIdFrom(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') throw new HttpError(400, 'Invalid project id.');
    if (!store.getProject(value)) throw new HttpError(400, 'Project not found.');
    return value;
  }

  function skillIdFrom(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') throw new HttpError(400, 'Invalid skill id.');
    if (!getSkill(workspaceRoot, value)) throw new HttpError(400, 'Skill not found.');
    return value;
  }

  async function saveArtifacts(processed, { conversationId = null, projectId = null } = {}) {
    const saved = [];
    for (const artifact of processed.artifacts.slice(0, 6)) {
      const record = store.addArtifact({
        conversationId,
        projectId,
        title: artifact.title,
        kind: artifact.kind,
        content: artifact.content
      });
      saved.push(record);
    }
    return saved;
  }

  function saveMemories(processed) {
    const saved = [];
    for (const memory of processed.memories.slice(0, 20)) {
      if (store.findMemoryByContent(memory.content)) continue;
      saved.push(store.addMemory(memory));
    }
    return saved;
  }

  async function runTask(task, { trigger = 'manual' } = {}) {
    if (activeTasks.has(task.id)) {
      throw new HttpError(409, 'This task is already running.');
    }
    activeTasks.add(task.id);
    const startedAt = nowIso();
    const run = store.addTaskRun({ taskId: task.id, status: 'running', startedAt });
    try {
      const context = buildSystemContext({
        store,
        config,
        workspaceRoot,
        projectId: task.projectId,
        skillId: task.skillId,
        thinking: false
      });
      const messages = buildMessages(store, null, { extraUserPrompt: task.prompt });
      const result = await collectModel({
        provider: provider(),
        system: context.system,
        stable: context.stable,
        dynamic: context.dynamic,
        messages,
        thinking: false,
        demoFast
      });
      const processed = processAssistantText(result.text);
      const artifacts = await saveArtifacts(processed, { projectId: task.projectId });
      const filename = `${slugify(task.name, 'task')}-${startedAt.replace(/[:.]/g, '-')}.md`;
      let output = [
        `# ${task.name}`,
        '',
        `_Run at ${startedAt}_`,
        '',
        processed.text || 'No text output.',
        artifacts.length
          ? `\n\n**Artifacts created:** ${artifacts.map((artifact) => `“${artifact.title}”`).join(', ')}`
          : '',
        '',
        `_Saved to data/outputs/${filename}_`
      ].join('\n');
      fs.writeFileSync(path.join(outputsDir, filename), output, 'utf8');
      const finished = store.finishTaskRun(run.id, { status: 'success', output });
      const current = store.getTask(task.id);
      store.setTaskRunTimes(task.id, {
        nextRunAt: current?.nextRunAt ?? null,
        lastRunAt: nowIso()
      });
      logger.log(`[tasks] ${trigger} run of "${task.name}" completed.`);
      return { ...finished, artifacts };
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : error.message || 'Task failed.';
      logger.error(`[tasks] "${task.name}" failed: ${message}`);
      return store.finishTaskRun(run.id, { status: 'error', error: message });
    } finally {
      activeTasks.delete(task.id);
    }
  }

  const scheduler = new Scheduler({
    store,
    runTask: (task, options) => runTask(task, options),
    logger
  });

  async function handleChat(req, res, conversationId) {
    const conversation = store.getConversation(conversationId);
    if (!conversation) throw new HttpError(404, 'Conversation not found.');
    if (activeChats.has(conversationId)) throw new HttpError(409, 'This chat is already generating a reply.');
    const body = await readJson(req);
    const content = requireString(body.content, 'Message', { max: 20_000 });
    const thinking = body.thinking === undefined ? conversation.thinking : Boolean(body.thinking);
    const skillId = body.skillId === undefined ? conversation.skillId : skillIdFrom(body.skillId);
    let projectId = conversation.projectId;
    if (Object.prototype.hasOwnProperty.call(body, 'projectId')) {
      projectId = projectIdFrom(body.projectId);
    }

    const updated = store.updateConversation(conversationId, { thinking, skillId, projectId });
    const userMessage = store.addMessage({ conversationId, role: 'user', content });
    const isFirstMessage = store.listMessages(conversationId).length === 1;
    const title = isFirstMessage ? titleFromMessage(content) : updated.title;
    if (isFirstMessage) store.touchConversation(conversationId, { title });

    const context = buildSystemContext({
      store,
      config,
      workspaceRoot,
      projectId,
      skillId,
      thinking
    });
    const messages = buildMessages(store, { id: conversationId });

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    res.flushHeaders?.();

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const currentProvider = provider();
    sseSend(res, 'start', {
      conversationId,
      title,
      userMessage,
      provider: { name: currentProvider.name, model: currentProvider.model },
      thinking
    });

    activeChats.add(conversationId);
    let rawText = '';
    let reasoning = '';
    let usage = null;
    try {
      for await (const event of streamModel({
        provider: currentProvider,
        system: context.system,
        stable: context.stable,
        dynamic: context.dynamic,
        messages,
        thinking,
        signal: controller.signal,
        demoFast
      })) {
        if (event.type === 'text') {
          rawText += event.delta;
          sseSend(res, 'text', { delta: event.delta });
        } else if (event.type === 'thinking') {
          reasoning += event.delta;
          sseSend(res, 'reasoning', { delta: event.delta });
        } else if (event.type === 'usage') {
          usage = event.usage;
        }
      }
      if (controller.signal.aborted) return;

      const processed = processAssistantText(rawText);
      const artifacts = await saveArtifacts(processed, { conversationId, projectId });
      const memories = config.memoryEnabled ? saveMemories(processed) : [];
      const finalText = processed.text || '(The model returned an empty response.)';
      const metadata = {
        provider: currentProvider.name,
        model: currentProvider.model,
        usage: usage || {
          prompt_tokens: estimateTokens(context.system),
          completion_tokens: estimateTokens(finalText),
          total_tokens: estimateTokens(context.system) + estimateTokens(finalText)
        },
        artifactIds: artifacts.map((artifact) => artifact.id)
      };
      const assistant = store.addMessage({
        conversationId,
        role: 'assistant',
        content: finalText,
        reasoning,
        meta: metadata
      });

      for (const artifact of artifacts) {
        sseSend(res, 'artifact', {
          id: artifact.id,
          title: artifact.title,
          kind: artifact.kind,
          createdAt: artifact.createdAt
        });
      }
      for (const memory of memories) {
        sseSend(res, 'memory', { id: memory.id, content: memory.content, category: memory.category });
      }
      sseSend(res, 'done', { message: assistant, artifacts, usage: metadata.usage, title });
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof ProviderError ? error.message : error.message || 'The model request failed.';
        sseSend(res, 'error', { message });
      }
    } finally {
      activeChats.delete(conversationId);
      if (!res.writableEnded) res.end();
    }
  }

  async function handleApi(req, res, url) {
    const { pathname, searchParams } = url;
    const method = req.method;
    const parts = pathname.split('/').filter(Boolean); // ['api', ...]

    if (pathname === '/api/health' && method === 'GET') {
      return { body: { ok: true, version: VERSION, uptime: Math.round(process.uptime()) } };
    }

    if (pathname === '/api/state' && method === 'GET') {
      const settings = publicSettings(config);
      return {
        body: {
          version: VERSION,
          harnessName: config.harnessName,
          provider: settings.effective,
          providerSelected: settings.provider,
          memoryEnabled: config.memoryEnabled,
          counts: { ...store.counts(), skills: listSkills(workspaceRoot).length },
          dataDir,
          demo: settings.effective.name === 'demo',
          warning: settings.effective.warning
        }
      };
    }

    if (pathname === '/api/projects') {
      if (method === 'GET') return { body: { projects: store.listProjects() } };
      if (method === 'POST') {
        const body = await readJson(req);
        const project = store.createProject({
          name: requireString(body.name, 'Project name', { max: 80 }),
          description: optionalString(body.description, 'Description', 1000) ?? '',
          instructions: optionalString(body.instructions, 'Instructions', 30_000) ?? ''
        });
        return { status: 201, body: { project } };
      }
    }

    let match = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (match) {
      const projectId = decodeURIComponent(match[1]);
      const project = store.getProject(projectId);
      if (!project) throw new HttpError(404, 'Project not found.');
      if (method === 'GET') {
        return {
          body: {
            project,
            documents: store.listDocuments(projectId),
            conversations: store.listConversations(projectId)
          }
        };
      }
      if (method === 'PATCH') {
        const body = await readJson(req);
        return {
          body: {
            project: store.updateProject(projectId, {
              name: body.name === undefined ? undefined : requireString(body.name, 'Project name', { max: 80 }),
              description: body.description === undefined ? undefined : optionalString(body.description, 'Description', 1000),
              instructions: body.instructions === undefined ? undefined : optionalString(body.instructions, 'Instructions', 30_000)
            })
          }
        };
      }
      if (method === 'DELETE') {
        store.deleteProject(projectId);
        return { body: { ok: true } };
      }
    }

    match = pathname.match(/^\/api\/projects\/([^/]+)\/documents$/);
    if (match) {
      const projectId = decodeURIComponent(match[1]);
      if (!store.getProject(projectId)) throw new HttpError(404, 'Project not found.');
      if (method === 'GET') return { body: { documents: store.listDocuments(projectId) } };
      if (method === 'POST') {
        const body = await readJson(req);
        const document = store.addDocument(projectId, {
          name: requireString(body.name, 'Document name', { max: 160 }),
          content: requireString(body.content, 'Document content', { max: 300_000 })
        });
        return { status: 201, body: { document } };
      }
    }

    match = pathname.match(/^\/api\/projects\/([^/]+)\/documents\/([^/]+)$/);
    if (match && method === 'DELETE') {
      const projectId = decodeURIComponent(match[1]);
      const documentId = decodeURIComponent(match[2]);
      if (!store.deleteDocument(projectId, documentId)) throw new HttpError(404, 'Document not found.');
      return { body: { ok: true } };
    }

    if (pathname === '/api/conversations') {
      if (method === 'GET') {
        const projectId = searchParams.get('projectId');
        return { body: { conversations: store.listConversations(projectId || undefined) } };
      }
      if (method === 'POST') {
        const body = await readJson(req);
        const conversation = store.createConversation({
          title: optionalString(body.title, 'Title', 120) || 'New chat',
          projectId: projectIdFrom(body.projectId),
          skillId: skillIdFrom(body.skillId),
          thinking: Boolean(body.thinking)
        });
        return { status: 201, body: { conversation } };
      }
    }

    match = pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (match) {
      const conversationId = decodeURIComponent(match[1]);
      const conversation = store.getConversation(conversationId);
      if (!conversation) throw new HttpError(404, 'Conversation not found.');
      if (method === 'GET') {
        return {
          body: {
            conversation,
            messages: store.listMessages(conversationId),
            artifacts: store.listArtifacts({ conversationId })
          }
        };
      }
      if (method === 'PATCH') {
        const body = await readJson(req);
        const patch = {};
        if (body.title !== undefined) patch.title = requireString(body.title, 'Title', { max: 120 });
        if (Object.prototype.hasOwnProperty.call(body, 'projectId')) patch.projectId = projectIdFrom(body.projectId);
        if (Object.prototype.hasOwnProperty.call(body, 'skillId')) patch.skillId = skillIdFrom(body.skillId);
        if (body.thinking !== undefined) patch.thinking = Boolean(body.thinking);
        return { body: { conversation: store.updateConversation(conversationId, patch) } };
      }
      if (method === 'DELETE') {
        store.deleteConversation(conversationId);
        return { body: { ok: true } };
      }
    }

    match = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (match && method === 'POST') {
      await handleChat(req, res, decodeURIComponent(match[1]));
      return { handled: true };
    }

    if (pathname === '/api/memory') {
      if (method === 'GET') return { body: { memories: store.listMemories() } };
      if (method === 'POST') {
        const body = await readJson(req);
        const category = MEMORY_CATEGORIES.has(body.category) ? body.category : 'fact';
        const memory = store.addMemory({
          content: requireString(body.content, 'Memory', { max: 2000 }),
          category
        });
        return { status: 201, body: { memory } };
      }
    }

    match = pathname.match(/^\/api\/memory\/([^/]+)$/);
    if (match) {
      const memoryId = decodeURIComponent(match[1]);
      if (method === 'PATCH') {
        const body = await readJson(req);
        const memory = store.updateMemory(memoryId, {
          content: body.content === undefined ? undefined : requireString(body.content, 'Memory', { max: 2000 }),
          category: body.category === undefined ? undefined : MEMORY_CATEGORIES.has(body.category) ? body.category : 'fact'
        });
        if (!memory) throw new HttpError(404, 'Memory not found.');
        return { body: { memory } };
      }
      if (method === 'DELETE') {
        if (!store.deleteMemory(memoryId)) throw new HttpError(404, 'Memory not found.');
        return { body: { ok: true } };
      }
    }

    if (pathname === '/api/prompts' && method === 'GET') {
      const file = path.join(workspaceRoot, 'prompts', 'roles.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { body: data };
    }

    if (pathname === '/api/skills') {
      if (method === 'GET') return { body: { skills: listSkills(workspaceRoot) } };
      if (method === 'POST') {
        const body = await readJson(req);
        const skill = createSkill(workspaceRoot, {
          name: requireString(body.name, 'Skill name', { max: 80 }),
          description: optionalString(body.description, 'Description', 240) ?? '',
          instructions: requireString(body.instructions, 'Instructions', { max: 20_000 })
        });
        return { status: 201, body: { skill } };
      }
    }

    match = pathname.match(/^\/api\/skills\/([^/]+)$/);
    if (match) {
      const skillId = decodeURIComponent(match[1]);
      if (method === 'PATCH') {
        const body = await readJson(req);
        const skill = updateSkill(workspaceRoot, skillId, {
          name: body.name === undefined ? undefined : requireString(body.name, 'Skill name', { max: 80 }),
          description: body.description === undefined ? undefined : optionalString(body.description, 'Description', 240),
          instructions: body.instructions === undefined ? undefined : requireString(body.instructions, 'Instructions', { max: 20_000 })
        });
        return { body: { skill } };
      }
      if (method === 'DELETE') {
        if (!deleteSkill(workspaceRoot, skillId)) throw new HttpError(404, 'Skill not found.');
        return { body: { ok: true } };
      }
    }

    if (pathname === '/api/artifacts' && method === 'GET') {
      const limit = Math.min(Number(searchParams.get('limit')) || 200, 500);
      return {
        body: {
          artifacts: store.listArtifacts({
            projectId: searchParams.get('projectId') || undefined,
            conversationId: searchParams.get('conversationId') || undefined,
            limit
          })
        }
      };
    }

    match = pathname.match(/^\/api\/artifacts\/([^/]+)$/);
    if (match) {
      const artifact = store.getArtifact(decodeURIComponent(match[1]));
      if (!artifact) throw new HttpError(404, 'Artifact not found.');
      if (method === 'GET') return { body: { artifact } };
      if (method === 'DELETE') {
        store.deleteArtifact(artifact.id);
        return { body: { ok: true } };
      }
    }

    match = pathname.match(/^\/api\/artifacts\/([^/]+)\/download$/);
    if (match && method === 'GET') {
      const artifact = store.getArtifact(decodeURIComponent(match[1]));
      if (!artifact) throw new HttpError(404, 'Artifact not found.');
      const extension = artifact.kind === 'svg' ? 'svg' : 'html';
      const filename = `${safeFilename(artifact.title, 'artifact')}.${extension}`;
      res.writeHead(200, {
        'content-type': artifact.kind === 'svg' ? 'image/svg+xml; charset=utf-8' : 'text/html; charset=utf-8',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'no-store'
      });
      res.end(artifact.content);
      return { handled: true };
    }

    if (pathname === '/api/tasks') {
      if (method === 'GET') {
        return { body: { tasks: store.listTasks().map((task) => ({ ...task, scheduleLabel: describeSchedule(task.scheduleKind, task.scheduleValue) })) } };
      }
      if (method === 'POST') {
        const body = await readJson(req);
        const scheduleKind = body.scheduleKind;
        let scheduleValue;
        try {
          scheduleValue = normalizeSchedule(scheduleKind, body.scheduleValue || {});
        } catch (error) {
          throw new HttpError(400, error.message);
        }
        const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
        const task = store.createTask({
          name: requireString(body.name, 'Task name', { max: 100 }),
          prompt: requireString(body.prompt, 'Prompt', { max: 20_000 }),
          scheduleKind,
          scheduleValue,
          projectId: projectIdFrom(body.projectId),
          skillId: skillIdFrom(body.skillId),
          enabled,
          nextRunAt: enabled ? computeNextRun(scheduleKind, scheduleValue, new Date()).toISOString() : null
        });
        return { status: 201, body: { task: { ...task, scheduleLabel: describeSchedule(task.scheduleKind, task.scheduleValue) } } };
      }
    }

    match = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (match) {
      const taskId = decodeURIComponent(match[1]);
      const task = store.getTask(taskId);
      if (!task) throw new HttpError(404, 'Task not found.');
      if (method === 'GET') {
        return {
          body: {
            task: { ...task, scheduleLabel: describeSchedule(task.scheduleKind, task.scheduleValue) },
            runs: store.listTaskRuns(taskId)
          }
        };
      }
      if (method === 'PATCH') {
        const body = await readJson(req);
        const scheduleKind = body.scheduleKind ?? task.scheduleKind;
        let scheduleValue = task.scheduleValue;
        if (body.scheduleKind !== undefined || body.scheduleValue !== undefined) {
          try {
            scheduleValue = normalizeSchedule(scheduleKind, body.scheduleValue ?? task.scheduleValue);
          } catch (error) {
            throw new HttpError(400, error.message);
          }
        }
        const enabled = body.enabled === undefined ? task.enabled : Boolean(body.enabled);
        let nextRunAt = task.nextRunAt;
        if (!enabled) nextRunAt = null;
        else if (body.enabled !== undefined || body.scheduleKind !== undefined || body.scheduleValue !== undefined) {
          nextRunAt = computeNextRun(scheduleKind, scheduleValue, new Date()).toISOString();
        }
        const updated = store.updateTask(taskId, {
          name: body.name === undefined ? undefined : requireString(body.name, 'Task name', { max: 100 }),
          prompt: body.prompt === undefined ? undefined : requireString(body.prompt, 'Prompt', { max: 20_000 }),
          scheduleKind,
          scheduleValue,
          projectId: Object.prototype.hasOwnProperty.call(body, 'projectId') ? projectIdFrom(body.projectId) : undefined,
          skillId: Object.prototype.hasOwnProperty.call(body, 'skillId') ? skillIdFrom(body.skillId) : undefined,
          enabled,
          nextRunAt
        });
        return { body: { task: { ...updated, scheduleLabel: describeSchedule(updated.scheduleKind, updated.scheduleValue) } } };
      }
      if (method === 'DELETE') {
        store.deleteTask(taskId);
        return { body: { ok: true } };
      }
    }

    match = pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
    if (match && method === 'POST') {
      const task = store.getTask(decodeURIComponent(match[1]));
      if (!task) throw new HttpError(404, 'Task not found.');
      const run = await runTask(task, { trigger: 'manual' });
      return { body: { run, task: store.getTask(task.id) } };
    }

    match = pathname.match(/^\/api\/tasks\/([^/]+)\/runs$/);
    if (match && method === 'GET') {
      return { body: { runs: store.listTaskRuns(decodeURIComponent(match[1])) } };
    }

    if (pathname === '/api/instructions') {
      const file = path.join(workspaceRoot, 'AGENTS.md');
      if (method === 'GET') {
        let content = '';
        try {
          content = fs.readFileSync(file, 'utf8');
        } catch {
          content = '';
        }
        return { body: { content, file: 'AGENTS.md' } };
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        const content = optionalString(body.content, 'Instructions', 100_000) ?? '';
        fs.writeFileSync(file, content, 'utf8');
        return { body: { content, file: 'AGENTS.md' } };
      }
    }

    if (pathname === '/api/context/preview' && method === 'POST') {
      const body = await readJson(req);
      const thinking = Boolean(body.thinking);
      const context = buildSystemContext({
        store,
        config,
        workspaceRoot,
        projectId: projectIdFrom(body.projectId),
        skillId: skillIdFrom(body.skillId),
        thinking
      });
      return {
        body: {
          system: context.system,
          characters: context.system.length,
          estimatedTokens: estimateTokens(context.system)
        }
      };
    }

    if (pathname === '/api/settings') {
      if (method === 'GET') return { body: { settings: publicSettings(config) } };
      if (method === 'PATCH') {
        const body = await readJson(req);
        let next;
        try {
          next = updateConfig(config, body);
        } catch (error) {
          throw new HttpError(400, error.message);
        }
        saveConfig(dataDir, next);
        config = next;
        return { body: { settings: publicSettings(config) } };
      }
    }

    if (pathname === '/api/settings/test' && method === 'POST') {
      const effective = provider();
      if (effective.name === 'demo' && config.provider !== 'demo') {
        return {
          body: {
            result: {
              ok: false,
              provider: 'demo',
              model: 'offline demo',
              message: effective.warning || 'No provider is configured.'
            }
          }
        };
      }
      return { body: { result: await testProvider(effective) } };
    }

    if (pathname === '/api/export' && method === 'GET') {
      const payload = {
        exportedAt: nowIso(),
        version: VERSION,
        settings: publicSettings(config),
        projects: store.listProjects().map((project) => ({
          ...project,
          documents: store.listDocuments(project.id)
        })),
        conversations: store.listConversations().map((conversation) => ({
          ...conversation,
          messages: store.listMessages(conversation.id)
        })),
        memories: store.listMemories(),
        artifacts: store.listArtifacts({ limit: 1000 }),
        tasks: store.listTasks().map((task) => ({
          ...task,
          runs: store.listTaskRuns(task.id, 100)
        }))
      };
      const filename = `agent-harness-export-${nowIso().slice(0, 10)}.json`;
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store'
      });
      res.end(JSON.stringify(payload, null, 2));
      return { handled: true };
    }

    throw new HttpError(404, 'Not found.');
  }

  function serveStatic(req, res, url) {
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'Invalid path.');
    }
    if (pathname === '/') pathname = '/index.html';
    if (pathname.startsWith('/artifact/')) pathname = '/artifact.html';

    const filePath = path.resolve(publicDir, `.${pathname}`);
    if (!filePath.startsWith(`${publicDir}${path.sep}`) && filePath !== publicDir) {
      throw new HttpError(403, 'Forbidden.');
    }
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new HttpError(404, 'Not found.');
    }
    if (!stat.isFile()) throw new HttpError(404, 'Not found.');
    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[extension] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': extension === '.html' ? 'no-store' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!hostIsLocal(req.headers.host)) {
        throw new HttpError(403, 'This server only accepts local requests.');
      }
      res.setHeader('x-content-type-options', 'nosniff');
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (url.pathname.startsWith('/api/')) {
        const result = await handleApi(req, res, url);
        if (result?.handled) return;
        if (!res.writableEnded) {
          json(res, result.status || 200, result.body);
        }
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, 'Method not allowed.');
      }
      serveStatic(req, res, url);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.status : error instanceof ProviderError ? error.status : 500;
      if (status >= 500) logger.error(error);
      json(res, status, {
        error: error.message || 'Something went wrong.',
        ...(error.details ? { details: error.details } : {})
      });
    }
  });

  if (startScheduler) scheduler.start();

  return {
    server,
    store,
    scheduler,
    workspaceRoot,
    dataDir,
    get config() {
      return config;
    },
    close() {
      scheduler.stop();
      store.close();
    }
  };
}
