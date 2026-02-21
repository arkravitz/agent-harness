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

