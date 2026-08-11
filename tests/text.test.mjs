import assert from 'node:assert/strict';
import test from 'node:test';
import { processAssistantText, stripArtifacts } from '../server/text.mjs';

test('extracts a single HTML artifact and trims it from the text', () => {
  const result = processAssistantText(`Here is the app.

\`\`\`html artifact="Habit tracker"
<!doctype html><html><body>Hello</body></html>
\`\`\`

Reload it to check.`);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].title, 'Habit tracker');
  assert.equal(result.artifacts[0].kind, 'html');
  assert.match(result.artifacts[0].content, /doctype html/);
  assert.doesNotMatch(result.text, /```html/);
  assert.match(result.text, /Reload it/);
});

test('supports svg artifacts, single quotes, and unquoted titles', () => {
  const svg = processAssistantText("```svg artifact='Diagram'\n<svg></svg>\n```");
  assert.equal(svg.artifacts[0].kind, 'svg');
  assert.equal(svg.artifacts[0].title, 'Diagram');

  const unquoted = processAssistantText('```html artifact=Thing\n<b>hi</b>\n```');
  assert.equal(unquoted.artifacts[0].title, 'Thing');
});

test('extracts memory tags and removes them from the reply', () => {
  const result = processAssistantText('Saved.\n<memory category="person">The user is named Ada.</memory>\n<memory>The user runs a newsletter.</memory>');
  assert.equal(result.memories.length, 2);
  assert.equal(result.memories[0].category, 'person');
  assert.equal(result.memories[1].category, 'fact');
  assert.equal(result.text, 'Saved.');
});

test('deduplicates repeated memory tags and caps content', () => {
  const long = 'x'.repeat(900);
  const result = processAssistantText(`<memory>same</memory><memory>same</memory><memory>${long}</memory>`);
  assert.equal(result.memories.length, 2);
  assert.ok(result.memories[1].content.length <= 600);
});

test('falls back to a short sentence when the reply is only an artifact', () => {
  const result = processAssistantText('```html artifact="Demo"\n<p>hi</p>\n```');
  assert.equal(result.text, 'Built the “Demo” artifact.');
});

test('ignores empty artifact blocks', () => {
  const result = processAssistantText('```html artifact="Empty"\n```');
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.text, '');
});

test('stripArtifacts removes the block but keeps the prose', () => {
  const value = 'Intro\n```html artifact="X"\n<p>x</p>\n```\nOutro';
  assert.equal(stripArtifacts(value), 'Intro\n\nOutro');
});
