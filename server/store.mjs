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

