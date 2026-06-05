import fs from 'node:fs';
import path from 'node:path';
import { HttpError, slugify } from './util.mjs';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;

export function skillsDir(root) {
  return path.join(root, 'skills');
}

export function parseSkill(id, raw, updatedAt = null) {
  const source = String(raw ?? '');
  let name = id;
  let description = '';
  let body = source;
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
      if (key === 'name' && value) name = value;
      if (key === 'description' && value) description = value;
    }
    body = match[2];
  }
  return {
    id,
    name,
    description,
    instructions: body.trim(),
    updatedAt
  };
}

export function listSkills(root) {
  const dir = skillsDir(root);
  if (!fs.existsSync(dir)) return [];
  const skills = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
    const file = path.join(dir, entry.name, 'SKILL.md');
    try {
      const stat = fs.statSync(file);
      skills.push(parseSkill(entry.name, fs.readFileSync(file, 'utf8'), stat.mtime.toISOString()));
    } catch {
      // A malformed or unreadable skill should not take down the list.
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function getSkill(root, skillId) {
  if (!ID_PATTERN.test(String(skillId ?? ''))) return null;
  const file = path.join(skillsDir(root), skillId, 'SKILL.md');
  try {
    const stat = fs.statSync(file);
    return parseSkill(skillId, fs.readFileSync(file, 'utf8'), stat.mtime.toISOString());
  } catch {
    return null;
  }
}

function writeSkill(root, skillId, { name, description, instructions }) {
  if (!ID_PATTERN.test(skillId)) throw new HttpError(400, 'Invalid skill id.');
  const dir = path.join(skillsDir(root), skillId);
  fs.mkdirSync(dir, { recursive: true });
  const safeName = String(name).replace(/\r?\n/g, ' ').trim();
  const safeDescription = String(description ?? '').replace(/\r?\n/g, ' ').trim();
  const body = `---\nname: ${safeName}\ndescription: ${safeDescription}\n---\n\n${String(instructions).trim()}\n`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body, 'utf8');
  return getSkill(root, skillId);
}

export function createSkill(root, { name, description = '', instructions }) {
  const base = slugify(name, 'skill').slice(0, 50);
  let candidate = base;
  let counter = 2;
  while (fs.existsSync(path.join(skillsDir(root), candidate))) {
    candidate = `${base.slice(0, 54)}-${counter++}`;
  }
  return writeSkill(root, candidate, { name, description, instructions });
}

export function updateSkill(root, skillId, patch) {
  const current = getSkill(root, skillId);
  if (!current) throw new HttpError(404, 'Skill not found.');
  return writeSkill(root, skillId, {
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    instructions: patch.instructions ?? current.instructions
  });
}

export function deleteSkill(root, skillId) {
  if (!ID_PATTERN.test(String(skillId ?? ''))) return false;
  const dir = path.join(skillsDir(root), skillId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
