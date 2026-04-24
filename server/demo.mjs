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

