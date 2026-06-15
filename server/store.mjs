import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { id, nowIso } from './util.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  skill_id TEXT,
  thinking INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  reasoning TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'fact',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'html',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule_kind TEXT NOT NULL,
  schedule_value TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  skill_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  output TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON tasks(next_run_at);
`;

const EXAMPLE_PROJECT = {
  name: 'Content studio (example)',
  description: 'An example project so you can see how fixed instructions and reference documents work. Edit or delete it.',
  instructions: `You are my content research assistant. I run a newsletter about AI and technology for an audience that already knows the field.

Do not explain basic concepts (what an LLM is, what an API is).

When I give you a topic or an article:
1. Pull out the 3 most surprising or counterintuitive angles.
2. Connect it to recent news I may have missed.
3. Suggest how to tell it as a story, not a summary.

Tone: direct, no corporate language, no filler.
Format: short paragraphs, no lists unless I ask for them.
Never start with "Great question!" or anything like it.`
};

function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documentCount: row.document_count ?? undefined,
    conversationCount: row.conversation_count ?? undefined
  };
}

function mapDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    content: row.content,
    createdAt: row.created_at
  };
}

function mapConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    skillId: row.skill_id,
    thinking: Boolean(row.thinking),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count ?? undefined,
    preview: row.preview ?? undefined
  };
}

function mapMessage(row) {
  if (!row) return null;
  let meta = null;
  if (row.meta) {
    try {
      meta = JSON.parse(row.meta);
    } catch {
      meta = null;
    }
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning || '',
    meta,
    createdAt: row.created_at
  };
}

function mapArtifact(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    title: row.title,
    kind: row.kind,
    content: row.content,
    createdAt: row.created_at,
    projectName: row.project_name ?? undefined
  };
}

function mapTask(row) {
  if (!row) return null;
  let scheduleValue = {};
  try {
    scheduleValue = JSON.parse(row.schedule_value);
  } catch {
    scheduleValue = {};
  }
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    scheduleKind: row.schedule_kind,
    scheduleValue,
    projectId: row.project_id,
    skillId: row.skill_id,
    enabled: Boolean(row.enabled),
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastStatus: row.last_status ?? undefined,
    projectName: row.project_name ?? undefined
  };
}

function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status,
    output: row.output,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

export class Store {
  constructor(dataDir, { seed = true } = {}) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'outputs'), { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'harness.db'));
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    if (seed) this.seed();
  }

  seed() {
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
    if (count > 0) return;
    this.createProject(EXAMPLE_PROJECT);
  }

  close() {
    this.db.close();
  }

  // --- projects ---------------------------------------------------------
  listProjects() {
    return this.db
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id) AS document_count,
          (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id) AS conversation_count
        FROM projects p
        ORDER BY p.updated_at DESC`
      )
      .all()
      .map(mapProject);
  }

  getProject(projectId) {
    return mapProject(this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId));
  }

  createProject({ name, description = '', instructions = '' }) {
    const projectId = id();
    const now = nowIso();
    this.db
      .prepare(
        'INSERT INTO projects (id, name, description, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(projectId, name, description, instructions, now, now);
    return this.getProject(projectId);
  }

  updateProject(projectId, patch) {
    const current = this.getProject(projectId);
    if (!current) return null;
    const next = {
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      instructions: patch.instructions ?? current.instructions
    };
    this.db
      .prepare('UPDATE projects SET name = ?, description = ?, instructions = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.description, next.instructions, nowIso(), projectId);
    return this.getProject(projectId);
  }

  deleteProject(projectId) {
    return this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId).changes > 0;
  }

  listDocuments(projectId) {
    return this.db
      .prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY created_at ASC')
      .all(projectId)
      .map(mapDocument);
  }

  getDocument(documentId) {
    return mapDocument(this.db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId));
  }

  addDocument(projectId, { name, content }) {
    const documentId = id();
    this.db
      .prepare('INSERT INTO documents (id, project_id, name, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(documentId, projectId, name, content, nowIso());
    this.touchProject(projectId);
    return this.getDocument(documentId);
  }

  deleteDocument(projectId, documentId) {
    return (
      this.db
        .prepare('DELETE FROM documents WHERE id = ? AND project_id = ?')
        .run(documentId, projectId).changes > 0
    );
  }

  touchProject(projectId) {
    this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowIso(), projectId);
  }

  // --- conversations ----------------------------------------------------
  listConversations(projectId) {
    const base = `SELECT c.*,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
      (SELECT substr(m.content, 1, 140) FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS preview
      FROM conversations c`;
    const rows = projectId
      ? this.db.prepare(`${base} WHERE c.project_id = ? ORDER BY c.updated_at DESC`).all(projectId)
      : this.db.prepare(`${base} ORDER BY c.updated_at DESC`).all();
    return rows.map(mapConversation);
  }

  getConversation(conversationId) {
    return mapConversation(this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId));
  }

  createConversation({ title = 'New chat', projectId = null, skillId = null, thinking = false } = {}) {
    const conversationId = id();
    const now = nowIso();
    this.db
      .prepare(
        'INSERT INTO conversations (id, project_id, title, skill_id, thinking, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(conversationId, projectId, title, skillId, thinking ? 1 : 0, now, now);
    return this.getConversation(conversationId);
  }

  updateConversation(conversationId, patch) {
    const current = this.getConversation(conversationId);
    if (!current) return null;
    const next = {
      title: patch.title ?? current.title,
      projectId: patch.projectId === undefined ? current.projectId : patch.projectId,
      skillId: patch.skillId === undefined ? current.skillId : patch.skillId,
      thinking: patch.thinking === undefined ? current.thinking : Boolean(patch.thinking)
    };
    this.db
      .prepare(
        'UPDATE conversations SET title = ?, project_id = ?, skill_id = ?, thinking = ?, updated_at = ? WHERE id = ?'
      )
      .run(next.title, next.projectId, next.skillId, next.thinking ? 1 : 0, nowIso(), conversationId);
    return this.getConversation(conversationId);
  }

  touchConversation(conversationId, { title } = {}) {
    if (title) {
      this.db
        .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
        .run(title, nowIso(), conversationId);
    } else {
      this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso(), conversationId);
    }
  }

  deleteConversation(conversationId) {
    return this.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId).changes > 0;
  }

  addMessage({ conversationId, role, content, reasoning = '', meta = null }) {
    const messageId = id();
    const createdAt = nowIso();
    this.db
      .prepare(
        'INSERT INTO messages (id, conversation_id, role, content, reasoning, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        messageId,
        conversationId,
        role,
        content,
        reasoning || null,
        meta ? JSON.stringify(meta) : null,
        createdAt
      );
    this.touchConversation(conversationId);
    return this.getMessage(messageId);
  }

  getMessage(messageId) {
    return mapMessage(this.db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId));
  }

  listMessages(conversationId) {
    return this.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(conversationId)
      .map(mapMessage);
  }

  // --- memory -----------------------------------------------------------
  listMemories() {
    return this.db
      .prepare('SELECT * FROM memories ORDER BY updated_at DESC')
      .all()
      .map((row) => ({
        id: row.id,
        content: row.content,
        category: row.category,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
  }

  getMemory(memoryId) {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId);
    if (!row) return null;
    return {
      id: row.id,
      content: row.content,
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  addMemory({ content, category = 'fact' }) {
    const memoryId = id();
    const now = nowIso();
    this.db
      .prepare('INSERT INTO memories (id, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(memoryId, content, category, now, now);
    return this.getMemory(memoryId);
  }

  updateMemory(memoryId, { content, category }) {
    const current = this.getMemory(memoryId);
    if (!current) return null;
    this.db
      .prepare('UPDATE memories SET content = ?, category = ?, updated_at = ? WHERE id = ?')
      .run(content ?? current.content, category ?? current.category, nowIso(), memoryId);
    return this.getMemory(memoryId);
  }

  deleteMemory(memoryId) {
    return this.db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId).changes > 0;
  }

  findMemoryByContent(content) {
    return this.db.prepare('SELECT * FROM memories WHERE content = ?').get(content) || null;
  }

  // --- artifacts --------------------------------------------------------
  addArtifact({ conversationId = null, projectId = null, title, kind = 'html', content }) {
    const artifactId = id();
    this.db
      .prepare(
        'INSERT INTO artifacts (id, conversation_id, project_id, title, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(artifactId, conversationId, projectId, title, kind, content, nowIso());
    return this.getArtifact(artifactId);
  }

  getArtifact(artifactId) {
    return mapArtifact(this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId));
  }

  listArtifacts({ projectId, conversationId, limit = 200 } = {}) {
    const clauses = [];
    const params = [];
    if (projectId) {
      clauses.push('a.project_id = ?');
      params.push(projectId);
    }
    if (conversationId) {
      clauses.push('a.conversation_id = ?');
      params.push(conversationId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    return this.db
      .prepare(
        `SELECT a.*, p.name AS project_name FROM artifacts a LEFT JOIN projects p ON p.id = a.project_id
         ${where} ORDER BY a.created_at DESC LIMIT ?`
      )
      .all(...params)
      .map(mapArtifact);
  }

  deleteArtifact(artifactId) {
    return this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(artifactId).changes > 0;
  }

  // --- tasks ------------------------------------------------------------
  listTasks() {
    return this.db
      .prepare(
        `SELECT t.*, p.name AS project_name,
          (SELECT status FROM task_runs r WHERE r.task_id = t.id ORDER BY r.started_at DESC LIMIT 1) AS last_status
         FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
         ORDER BY t.enabled DESC, t.next_run_at ASC, t.created_at DESC`
      )
      .all()
      .map(mapTask);
  }

  getTask(taskId) {
    return mapTask(
      this.db
        .prepare(
          `SELECT t.*, p.name AS project_name,
            (SELECT status FROM task_runs r WHERE r.task_id = t.id ORDER BY r.started_at DESC LIMIT 1) AS last_status
           FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?`
        )
        .get(taskId)
    );
  }

  createTask({
    name,
    prompt,
    scheduleKind,
    scheduleValue,
    projectId = null,
    skillId = null,
    enabled = true,
    nextRunAt = null
  }) {
    const taskId = id();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO tasks (id, name, prompt, schedule_kind, schedule_value, project_id, skill_id, enabled, next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        taskId,
        name,
        prompt,
        scheduleKind,
        JSON.stringify(scheduleValue),
        projectId,
        skillId,
        enabled ? 1 : 0,
        nextRunAt,
        now,
        now
      );
    return this.getTask(taskId);
  }

  updateTask(taskId, patch) {
    const current = this.getTask(taskId);
    if (!current) return null;
    const next = {
      name: patch.name ?? current.name,
      prompt: patch.prompt ?? current.prompt,
      scheduleKind: patch.scheduleKind ?? current.scheduleKind,
      scheduleValue: patch.scheduleValue ?? current.scheduleValue,
      projectId: patch.projectId === undefined ? current.projectId : patch.projectId,
      skillId: patch.skillId === undefined ? current.skillId : patch.skillId,
      enabled: patch.enabled === undefined ? current.enabled : Boolean(patch.enabled),
      nextRunAt: patch.nextRunAt === undefined ? current.nextRunAt : patch.nextRunAt
    };
    this.db
      .prepare(
        `UPDATE tasks SET name = ?, prompt = ?, schedule_kind = ?, schedule_value = ?, project_id = ?, skill_id = ?,
         enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        next.name,
        next.prompt,
        next.scheduleKind,
        JSON.stringify(next.scheduleValue),
        next.projectId,
        next.skillId,
        next.enabled ? 1 : 0,
        next.nextRunAt,
        nowIso(),
        taskId
      );
    return this.getTask(taskId);
  }

  deleteTask(taskId) {
    return this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId).changes > 0;
  }

  dueTasks(now = nowIso()) {
    return this.db
      .prepare('SELECT * FROM tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC')
      .all(now)
      .map(mapTask);
  }

  setTaskRunTimes(taskId, { nextRunAt, lastRunAt }) {
    this.db
      .prepare('UPDATE tasks SET next_run_at = ?, last_run_at = ?, updated_at = ? WHERE id = ?')
      .run(nextRunAt, lastRunAt, nowIso(), taskId);
  }

  addTaskRun({ taskId, status = 'running', output = null, error = null, startedAt = nowIso(), finishedAt = null }) {
    const runId = id();
    this.db
      .prepare(
        'INSERT INTO task_runs (id, task_id, status, output, error, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(runId, taskId, status, output, error, startedAt, finishedAt);
    return mapRun(this.db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId));
  }

  finishTaskRun(runId, { status, output = null, error = null, finishedAt = nowIso() }) {
    this.db
      .prepare('UPDATE task_runs SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?')
      .run(status, output, error, finishedAt, runId);
    return mapRun(this.db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId));
  }

  listTaskRuns(taskId, limit = 20) {
    return this.db
      .prepare('SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(taskId, limit)
      .map(mapRun);
  }

  getTaskRun(runId) {
    return mapRun(this.db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId));
  }

  counts() {
    const get = (table) => this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    return {
      projects: get('projects'),
      conversations: get('conversations'),
      memories: get('memories'),
      artifacts: get('artifacts'),
      tasks: get('tasks')
    };
  }
}
