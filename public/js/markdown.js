const CODE_TOKEN = /\u0000(\d+)\u0000/g;

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function safeUrl(url) {
  const value = String(url || '');
  return /^(https?:\/\/|mailto:)/i.test(value) ? value : null;
}

function inline(value) {
  let text = String(value);
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return `\u0001${inlineCodes.length - 1}\u0001`;
  });

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const safe = safeUrl(url);
    if (!safe) return label;
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

  text = text.replace(/\u0001(\d+)\u0001/g, (_, index) => {
    return `<code>${inlineCodes[Number(index)]}</code>`;
  });
  return text;
}

function codeBlock(block, index) {
  const language = block.language || 'code';
  return `<div class="code-block"><div class="code-head"><span>${escapeHtml(language)}</span><button type="button" class="copy-code" aria-label="Copy code">Copy</button></div><pre><code data-code-index="${index}">${escapeHtml(block.code)}</code></pre></div>`;
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');
}

function splitRow(line) {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map((cell) => cell.trim());
}

function renderTable(lines, start) {
  const header = splitRow(lines[start]);
  let index = start + 2;
  const rows = [];
  while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
    rows.push(splitRow(lines[index]));
    index += 1;
  }
  const head = `<thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`;
  const body = rows.length
    ? `<tbody>${rows.map((row) => `<tr>${header.map((_, cellIndex) => `<td>${inline(row[cellIndex] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';
  return { html: `<div class="table-wrap"><table>${head}${body}</table></div>`, next: index };
}

function collectList(lines, start, marker, strip) {
  const items = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (marker.test(line)) {
      items.push(line.replace(strip, ''));
      index += 1;
      continue;
    }
    const continuation = line.match(/^\s{2,}(\S.*)$/);
    if (items.length && continuation && !/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      items[items.length - 1] += ` ${continuation[1].trim()}`;
      index += 1;
      continue;
    }
    break;
  }
  return { items, next: index };
}

/**
 * Small, dependency-free Markdown renderer. It escapes first, then adds a
 * deliberately limited set of tags, so model output cannot inject HTML.
 */
export function renderMarkdown(source) {
  const codeBlocks = [];
  let text = String(source ?? '').replace(/\r\n/g, '\n');
  text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, info, code) => {
    const language = info.trim().split(/\s+/)[0] || '';
    codeBlocks.push({ language, code: code.replace(/\n$/, '') });
    return `\n\u0000${codeBlocks.length - 1}\u0000\n`;
  });
  text = escapeHtml(text);

  const lines = text.split('\n');
  const blocks = [];
  let index = 0;

  const flushParagraph = (paragraph) => {
    if (!paragraph.length) return;
    const body = paragraph.join('\n');
    const tokenOnly = body.match(/^\s*\u0000(\d+)\u0000\s*$/);
    if (tokenOnly) {
      blocks.push(`\u0000${tokenOnly[1]}\u0000`);
    } else {
      blocks.push(`<p>${inline(body).replace(/\n/g, '<br>')}</p>`);
    }
    paragraph.length = 0;
  };

  const paragraph = [];
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(paragraph);
      index += 1;
      continue;
    }

    const token = trimmed.match(/^\u0000(\d+)\u0000$/);
    if (token) {
      flushParagraph(paragraph);
      blocks.push(`\u0000${token[1]}\u0000`);
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph(paragraph);
      const level = Math.min(heading[1].length + 1, 6);
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^(---|\*\*\*|___)\s*$/.test(trimmed)) {
      flushParagraph(paragraph);
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph(paragraph);
      const quote = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${quote.map((entry) => inline(entry)).join('<br>')}</blockquote>`);
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph(paragraph);
      const table = renderTable(lines, index);
      blocks.push(table.html);
      index = table.next;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph(paragraph);
      const list = collectList(lines, index, /^\s*[-*+]\s+/, /^\s*[-*+]\s+/);
      index = list.next;
      blocks.push(`<ul>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph(paragraph);
      const list = collectList(lines, index, /^\s*\d+[.)]\s+/, /^\s*\d+[.)]\s+/);
      index = list.next;
      blocks.push(`<ol>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`);
      continue;
    }

    paragraph.push(line);
    index += 1;
  }
  flushParagraph(paragraph);

  let html = blocks.join('\n');
  html = html.replace(CODE_TOKEN, (_, blockIndex) => {
    const block = codeBlocks[Number(blockIndex)];
    return block ? codeBlock(block, Number(blockIndex)) : '';
  });
  return html;
}

/** Copy-to-clipboard for rendered code blocks is handled by delegation. */
export async function copyText(value) {
  const text = String(value ?? '');
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
