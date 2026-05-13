import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HABIT_TRACKER = fs.readFileSync(path.join(here, 'fixtures', 'habit-tracker.html'), 'utf8');
const LANDING_PAGE = fs.readFileSync(path.join(here, 'fixtures', 'landing-page.html'), 'utf8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function lastUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return messages[index].content;
  }
  return '';
}

function classify(text) {
  const value = text.toLowerCase();
  if (/habit|streak|routine|tracker|racha/.test(value)) return 'habit';
  if (/landing|one-?pager|home ?page|hero section|website/.test(value)) return 'landing';
  if (/brief|news|noticias|roundup|headline|newsletter/.test(value)) return 'brief';
  if (/remember|memor|what do you know about me/.test(value)) return 'memory';
  if (/what can you do|capabilities|help me understand the app|how does this work/.test(value)) return 'capabilities';
  return 'default';
}

function memoryReply(text) {
  const name = text.match(/my name is ([A-Z][A-Za-z'’-]{1,40})/);
  const preference = text.match(/i prefer ([^.!?\n]{2,120})/i);
  const fact = text.match(/remember (?:that )?([^.!?\n]{2,180})/i);
  if (name) {
    return {
      reasoning:
        'The user asked me to remember their name. In demo mode there is no model, but I can still demonstrate the <memory> extraction path.',
      text: `<memory category="person">The user's name is ${name[1]}.</memory>\n\nSaved. That fact will be included in every new conversation. You can review or delete it on the Memory page.`
    };
  }
  if (preference) {
    return {
      reasoning:
        'This is a durable preference, which is exactly what the memory feature is for. I will emit a memory tag rather than storing it myself.',
      text: `<memory category="preference">The user prefers ${preference[1].trim()}.</memory>\n\nSaved as a preference. It will shape future replies, and you can edit it on the Memory page.`
    };
  }
  if (fact) {
    return {
      reasoning: 'The user used an explicit remember instruction. I will save it as a fact.',
      text: `<memory category="fact">${fact[1].trim()}</memory>\n\nSaved. This is a demo of the memory pipeline: the tag is stripped from the visible reply and written to the local database.`
    };
  }
  return {
    reasoning:
      'The user is asking about memory. Since this is offline demo mode, I should explain the mechanism and point at where to inspect it.',
    text:
      'Memory in this harness is a small local list of durable facts. Every chat gets those facts in its system context; nothing is sent anywhere else.\n\nAdd one on the **Memory** page, or say “remember that…” in a chat. In demo mode I will actually save a simple name or preference so you can see the tag disappear and the memory appear.\n\nMemory can be switched off in Settings.'
  };
}

export function demoReply(messages, { thinking = false } = {}) {
  const text = lastUserMessage(messages);
  const kind = classify(text);
  const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date());

  if (kind === 'habit') {
    return {
      kind,
      reasoning:
        'The user wants a working habit tracker, not a description of one. The right move is a single self-contained HTML file: five habits, the last seven days, a streak that resets on a missed day, localStorage persistence, and a small completion animation. I will put it in an artifact block so the app can preview it inline.',
      text: `Here is a working habit tracker: five habits, a seven-day grid, and a streak that resets the moment a day is missed. State lives in localStorage, so it survives a reload.

\`\`\`html artifact="Momentum — habit tracker"
${HABIT_TRACKER}
\`\`\`

Tap a few days and reload the preview: the check-ins stick. To use your own habits, edit the \`DEFAULT_HABITS\` array near the top of the script.`
    };
  }

  if (kind === 'landing') {
    return {
      kind,
      reasoning:
        'A landing page request maps cleanly to one self-contained HTML artifact. I will avoid external fonts and images, keep one accent color, and make it responsive and keyboard accessible.',
      text: `Built a single-file landing page with a hero, three benefits, testimonials, and a working contact form. No external assets, so it renders the same offline.

\`\`\`html artifact="Draft — landing page"
${LANDING_PAGE}
\`\`\`

The form validates locally and shows a success state; it does not submit anywhere. Swap the copy and the accent variable to make it yours.`
    };
  }

  if (kind === 'brief') {
    return {
      kind,
      reasoning:
        'The user wants a news brief, but this is offline demo mode with no web access. Fabricating five current stories would be worse than showing the exact output shape.',
      text: `**Offline demo, not live news.** No web access is configured, so here is the exact shape a scheduled brief would take.

# Daily brief — ${date}

**1. A small model ships on-device** — A team releases a model that runs without a network connection. The interesting part is not the benchmark; it is the distribution change.
**Why it matters:** local inference removes a per-request cost line and changes what you can build for privacy-sensitive users.

**2. An API gets cheaper, quietly** — A provider cuts the price of cached context.
**Why it matters:** products with long system prompts should re-run their unit economics this week.

**3. An open-weight release with a restrictive license** — The weights are available, the commercial terms are not obviously compatible with SaaS.
**Why it matters:** check the license before building a moat on top of it.

**4. A tooling company buys a data company** — The acquisition is about proprietary workflows, not the model.
**Why it matters:** integrations you rely on may move up the stack.

**5. A benchmark result that does not reproduce** — Independent runs disagree with the headline number.
**Why it matters:** wait for the third-party eval before changing your stack.

**One thing to watch today:** whether the cached-input price cut is permanent or a launch-week promotion.

Connect a model in Settings and this becomes a real brief instead of a template.`
    };
  }

  if (kind === 'memory') return { kind, ...memoryReply(text) };

  if (kind === 'capabilities') {
    return {
      kind,
      reasoning:
        'The user wants to understand the harness. A short tour of what is local and what is deliberately missing is more useful than a feature list.',
      text: `This is a local-first agent harness. It runs as a small Node server on your machine and stores everything in \`data/\`.

**What works right now, offline**
- **Projects** — fixed instructions and text reference documents shared by every chat in the project.
- **Memory** — durable facts injected into every conversation.
- **Artifacts** — self-contained HTML/SVG apps generated by the model, previewed in a sandbox, saved locally, with working localStorage.
- **Skills** — Markdown instruction packs you can attach to a chat.
- **Automations** — scheduled prompts. They run while this server is running, not in the cloud.
- **Role library** — the prompts from the article, translated to English.

**What the real model adds**
- Actual conversation, reasoning, and code generation. Demo mode only returns canned demonstrations.
- Anthropic extended thinking and prompt caching, or any OpenAI-compatible endpoint, once a key is connected.

**What is deliberately missing**
- Browser control, Gmail/Calendar/Notion connectors, shell access, and video editing. Each one needs OS-level access, OAuth, or global installs, which breaks the “workspace only” rule.

Open **Settings** to connect a model.`
    };
  }

  return {
    kind,
    reasoning: thinking
      ? 'There is no model connected, so I cannot answer the question itself. The useful response is to be explicit about demo mode and show how to leave it.'
      : '',
    text: `**Offline demo mode.** I do not have a model connected, so I cannot answer that as a real assistant would.

The harness around the model is real and running locally: projects, memory, artifacts, skills, scheduled tasks, and a saved conversation history. The demo replies are canned so you can click through all of it without a key.

To get real answers:
1. Open **Settings**.
2. Choose **OpenAI-compatible** (OpenAI, DeepSeek, OpenRouter, LM Studio, Ollama) or **Anthropic**.
3. Save the base URL, model, and API key, then test the connection.

Or set \`OPENAI_API_KEY\`, \`DEEPSEEK_API_KEY\`, or \`ANTHROPIC_API_KEY\` in a local \`.env\` file and restart.

Try one of the demo suggestions in the empty chat: the habit tracker and landing page are complete working artifacts.`
  };
}

function chunkWords(text, size = 6) {
  const tokens = String(text).match(/\S+\s*/g) || [String(text)];
  const chunks = [];
  for (let index = 0; index < tokens.length; index += size) {
    chunks.push(tokens.slice(index, index + size).join(''));
  }
  return chunks;
}

export async function* streamDemo({ messages, thinking = false, fast = false, signal = null }) {
  const reply = demoReply(messages, { thinking });
  if (thinking && reply.reasoning) {
    for (const chunk of chunkWords(reply.reasoning, 5)) {
      if (signal?.aborted) return;
      yield { type: 'thinking', delta: chunk };
      if (!fast) await sleep(16);
    }
  }
  for (const chunk of chunkWords(reply.text, 5)) {
    if (signal?.aborted) return;
    yield { type: 'text', delta: chunk };
    if (!fast) await sleep(14);
  }
  const promptChars = messages.reduce((total, message) => total + message.content.length, 0);
  yield {
    type: 'usage',
    usage: {
      prompt_tokens: Math.ceil(promptChars / 4),
      completion_tokens: Math.ceil(reply.text.length / 4),
      total_tokens: Math.ceil((promptChars + reply.text.length) / 4)
    }
  };
}
