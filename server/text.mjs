const ARTIFACT_PATTERN =
  /```(html|svg)[ \t]+artifact=(?:"([^"]+)"|'([^']+)'|([^\s`]+))[ \t]*\r?\n([\s\S]*?)```/gi;

const MEMORY_PATTERN = /<memory(?:\s+category=["']?([a-zA-Z]+)["']?)?>([\s\S]*?)<\/memory>/gi;

const MEMORY_CATEGORIES = new Set(['fact', 'preference', 'project', 'person']);

/**
 * Pull artifact fenced blocks and <memory> tags out of a model response.
 * Everything is capped so one runaway response cannot fill the database.
 */
export function processAssistantText(raw) {
  let text = String(raw ?? '');
  const artifacts = [];
  for (const match of text.matchAll(ARTIFACT_PATTERN)) {
    const kind = match[1].toLowerCase();
    const title = (match[2] || match[3] || match[4] || 'Untitled artifact').trim().slice(0, 120);
    const content = match[5].trim();
    if (!content) continue;
    artifacts.push({ kind, title: title || 'Untitled artifact', content: content.slice(0, 500_000) });
  }
  text = text.replace(ARTIFACT_PATTERN, '').trim();

  const memories = [];
  const seen = new Set();
  for (const match of text.matchAll(MEMORY_PATTERN)) {
    const category = MEMORY_CATEGORIES.has((match[1] || '').toLowerCase())
      ? match[1].toLowerCase()
      : 'fact';
    const content = match[2].replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!content || seen.has(content.toLowerCase())) continue;
    seen.add(content.toLowerCase());
    memories.push({ category, content });
  }
  text = text.replace(MEMORY_PATTERN, '').trim();

  if (!text && artifacts.length) {
    text = artifacts.length === 1
      ? `Built the “${artifacts[0].title}” artifact.`
      : `Built ${artifacts.length} artifacts.`;
  }

  return { text, artifacts, memories };
}

/** Remove artifact blocks only, used for small previews. */
export function stripArtifacts(text) {
  return String(text ?? '').replace(ARTIFACT_PATTERN, '').trim();
}
