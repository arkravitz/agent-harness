import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeHtml, renderMarkdown } from '../public/js/markdown.js';

test('escapes raw HTML before rendering', () => {
  const html = renderMarkdown('<script>alert("x")</script>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('renders headings, bold, italic, and inline code', () => {
  const html = renderMarkdown('# Title\n\nA **bold** and *italic* line with `code`.');
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>code<\/code>/);
});

test('renders fenced code as escaped code blocks', () => {
  const html = renderMarkdown('```js\nconst x = "<tag>";\n```');
  assert.match(html, /class="code-block"/);
  assert.match(html, /const x = &quot;&lt;tag&gt;&quot;;/);
  assert.doesNotMatch(html, /<tag>/);
});

test('keeps indented continuation lines inside list items', () => {
  const html = renderMarkdown('- First line\n  continues here\n- Second item');
  assert.equal((html.match(/<li>/g) || []).length, 2);
  assert.match(html, /First line continues here/);
  assert.doesNotMatch(html, /<p>continues/);
});

test('renders ordered lists and tables', () => {
  const html = renderMarkdown('1. One\n2. Two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
  assert.match(html, /<ol>/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td>2<\/td>/);
});

test('rejects unsafe links but keeps the label', () => {
  const html = renderMarkdown('[click](javascript:alert(1))');
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /click/);
});

test('allows http and mailto links', () => {
  const html = renderMarkdown('[site](https://example.com) [mail](mailto:a@b.com)');
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /href="mailto:a@b.com"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('escapeHtml handles all special characters', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});
