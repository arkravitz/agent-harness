import { api, streamChat } from './js/api.js';
import { icon } from './js/icons.js';
import { copyText, renderMarkdown } from './js/markdown.js';
import {
  buildArtifactDocument,
  downloadArtifact,
  loadArtifactStorage,
  randomToken,
  saveArtifactStorage
} from './js/artifact-view.js';
import {
  escapeHtml,
  formatDate,
  formatDateTime,
  plural,
  readFileAsText,
  timeAgo,
  truncate
} from './js/util.js';

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toasts');

const NAV = [
  { id: 'chat', label: 'Chat', icon: 'chat', href: '#/chat' },
  { id: 'projects', label: 'Projects', icon: 'folder', href: '#/projects' },
  { id: 'memory', label: 'Memory', icon: 'brain', href: '#/memory' },
  { id: 'library', label: 'Library', icon: 'sparkles', href: '#/library' },
  { id: 'automations', label: 'Automations', icon: 'clock', href: '#/automations' },
  { id: 'skills', label: 'Skills', icon: 'layers', href: '#/skills' },
  { id: 'artifacts', label: 'Artifacts', icon: 'grid', href: '#/artifacts' },
  { id: 'instructions', label: 'Instructions', icon: 'book', href: '#/instructions' }
];

const SUGGESTIONS = [
  {
    icon: 'grid',
    title: 'Build a habit tracker',
    copy: 'A working app with streaks and local persistence.',
    prompt:
      'Build me a habit tracker as a working web app. I want to track 5 daily habits and mark them each day. Show a 7-day streak for each habit. If I miss a day, the streak resets to zero. Design: dark, minimal. Marking a habit should have a small satisfying animation. Data must persist when I reload the page.'
  },
  {
    icon: 'image',
    title: 'Design a landing page',
    copy: 'A single-file page with a hero, proof, and a form.',
    prompt:
      'Design a landing page for an AI newsletter. Audience: engineers and founders who already know the basics. Include a hero with a headline and CTA, three benefits with icons, two testimonials, and a contact form. Dark, modern, large typography. Make it a single self-contained HTML artifact.'
  },
  {
    icon: 'clock',
    title: 'Draft a morning brief',
    copy: 'Five AI stories, stripped of filler, in three minutes.',
    prompt:
      'Draft a 5-item AI news brief for today. For each item: a headline, a two-sentence summary, and one sentence on why it matters to someone building with AI. Direct and analytical. End with one thing to watch.'
  },
  {
    icon: 'brain',
    title: 'Think through a hard call',
    copy: 'Second-order consequences, bias checks, a real recommendation.',
    prompt:
      'I have to choose between two options and I want you to think carefully before answering.\n\nOption A: [describe A]\nOption B: [describe B]\n\nMy situation: [context, constraints, what matters most]\n\nBefore answering, analyze the second- and third-order consequences, what I may be overvaluing because of emotion, what information I am missing, and which option protects me best if things go wrong. Then give me your real recommendation and why.'
  }
];

const state = {
  boot: null,
  chat: null,
  stream: null,
  routeSerial: 0,
  copyMap: new Map(),
  artifactChannels: new Map(),
  modalClose: null
};

/* ------------------------------------------------------------------ shell */

function renderShell(active, content) {
  const providerName = state.boot?.state?.provider?.name || 'demo';
  const providerText =
    providerName === 'demo'
      ? 'Demo mode'
      : state.boot?.state?.provider?.model || providerName;
  const providerClass = providerName === 'demo' ? 'warn' : 'ok';
  return `<div class="shell">
    <aside class="rail">
      <a class="brand" href="#/chat" aria-label="Agent Harness home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="brand-text">Agent<br><em>Harness</em></span>
      </a>
      <a class="new-chat" href="#/chat/new">${icon('plus', 16)}<span>New chat</span></a>
      <nav class="rail-nav" aria-label="Primary">
        ${NAV.map(
          (item) => `<a class="nav-item ${active === item.id ? 'active' : ''}" href="${item.href}">
            ${icon(item.icon, 19)}<span>${item.label}</span>
          </a>`
        ).join('')}
      </nav>
      <div class="rail-foot">
        <a class="provider-chip ${providerClass}" href="#/settings" title="${escapeHtml(state.boot?.state?.provider?.warning || 'Model connection')}">
          <span class="status-dot"></span><span>${escapeHtml(providerText)}</span>
        </a>
        <a class="nav-item ${active === 'settings' ? 'active' : ''}" href="#/settings">
          ${icon('settings', 19)}<span>Settings</span>
        </a>
        <span class="rail-version">v0.1 · local</span>
      </div>
    </aside>
    <main class="main">${content}</main>
  </div>`;
}

function pageHead({ eyebrow = '', title, subtitle = '', actions = '' }) {
  return `<header class="page-head">
    <div>
      ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="page-sub">${subtitle}</p>` : ''}
    </div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </header>`;
}

function emptyBlock(iconName, title, copy, action = '') {
  return `<div class="empty-block">
    <span class="empty-icon">${icon(iconName, 22)}</span>
    <h2>${escapeHtml(title)}</h2>
    <p>${copy}</p>
    ${action}
  </div>`;
}

function toast(message, kind = 'info') {
  const element = document.createElement('div');
  element.className = `toast ${kind}`;
  element.setAttribute('role', 'status');
  element.textContent = message;
  toastRoot.append(element);
  setTimeout(() => {
    element.classList.add('leaving');
    setTimeout(() => element.remove(), 250);
  }, 3800);
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.original = button.textContent;
    button.disabled = true;
    button.textContent = label || 'Working…';
  } else {
    button.disabled = false;
    button.textContent = button.dataset.original || button.textContent;
  }
}

/* ------------------------------------------------------------------ modals */

function closeModal() {
  modalRoot.innerHTML = '';
  document.body.classList.remove('modal-open');
  state.artifactChannels.clear();
  state.modalClose = null;
}

function openModal({ title, eyebrow = '', body, wide = false }) {
  closeModal();
  modalRoot.innerHTML = `<div class="modal-backdrop">
    <section class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <header class="modal-head">
        <div>
          ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button class="icon-btn" type="button" data-modal-close aria-label="Close">${icon('close', 18)}</button>
      </header>
      <div class="modal-body">${body}</div>
    </section>
  </div>`;
  document.body.classList.add('modal-open');
  const backdrop = modalRoot.querySelector('.modal-backdrop');
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) closeModal();
  });
  modalRoot.querySelectorAll('[data-modal-close]').forEach((button) => {
    button.addEventListener('click', closeModal);
  });
  state.modalClose = closeModal;
  return modalRoot.querySelector('.modal');
}

function formError(form, message) {
  let box = form.querySelector('.form-error');
  if (!box) {
    box = document.createElement('p');
    box.className = 'form-error';
    form.append(box);
  }
  box.textContent = message;
}

async function openArtifactModal(artifactId) {
  const serial = state.routeSerial;
  try {
    const { artifact } = await api.artifact(artifactId);
    if (serial !== state.routeSerial) return;
    closeModal();
    const token = randomToken();
    state.artifactChannels.set(token, artifact.id);
    const snapshot = loadArtifactStorage(artifact.id);
    modalRoot.innerHTML = `<div class="modal-backdrop artifact-backdrop">
      <section class="modal modal-artifact" role="dialog" aria-modal="true" aria-label="${escapeHtml(artifact.title)}">
        <header class="artifact-head">
          <div>
            <p class="eyebrow">${artifact.kind.toUpperCase()} artifact · sandboxed</p>
            <h2>${escapeHtml(artifact.title)}</h2>
          </div>
          <div class="artifact-actions">
            <button class="btn ghost small" type="button" data-artifact-download="${artifact.id}">${icon('download', 15)} Download</button>
            <a class="btn ghost small" href="/artifact/${artifact.id}" target="_blank" rel="noopener">${icon('external', 15)} New tab</a>
            <button class="icon-btn" type="button" data-modal-close aria-label="Close">${icon('close', 18)}</button>
          </div>
        </header>
        <div class="artifact-frame-wrap">
          <iframe class="artifact-frame" title="${escapeHtml(artifact.title)}" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"></iframe>
        </div>
      </section>
    </div>`;
    document.body.classList.add('modal-open');
    const frame = modalRoot.querySelector('.artifact-frame');
    frame.srcdoc = buildArtifactDocument(artifact, snapshot, token);
    modalRoot.querySelectorAll('[data-modal-close]').forEach((button) => {
      button.addEventListener('click', () => {
        state.artifactChannels.delete(token);
        closeModal();
      });
    });
    modalRoot.querySelector('[data-artifact-download]')?.addEventListener('click', () => {
      downloadArtifact(artifact);
    });
    state.modalClose = () => {
      state.artifactChannels.delete(token);
      closeModal();
    };
  } catch (error) {
    toast(error.message, 'error');
  }
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.__harnessArtifact) return;
  if (state.artifactChannels.get(data.token) !== data.id) return;
  saveArtifactStorage(data.id, data.data);
});

/* ------------------------------------------------------------------ router */

function parseHash() {
  const value = location.hash.replace(/^#\/?/, '');
  if (!value) return { section: 'chat', id: null };
  const [section, ...rest] = value.split('/');
  return { section, id: rest.length ? decodeURIComponent(rest.join('/')) : null };
}

function abortStream() {
  if (state.stream) {
    state.stream.abort.abort();
    state.stream = null;
  }
}

async function route() {
  abortStream();
  state.routeSerial += 1;
  const { section, id } = parseHash();
  closeModal();
  try {
    if (section === 'chat') return await renderChat(id);
    if (section === 'projects') return id ? await renderProjectDetail(id) : await renderProjects();
    if (section === 'memory') return await renderMemory();
    if (section === 'library') return await renderLibrary();
    if (section === 'automations') return await renderAutomations();
    if (section === 'skills') return await renderSkills();
    if (section === 'artifacts') return await renderArtifacts();
    if (section === 'instructions') return await renderInstructions();
    if (section === 'settings') return await renderSettings();
    location.hash = '#/chat';
  } catch (error) {
    renderError(error, section);
  }
}

function renderError(error, active = 'chat') {
  app.innerHTML = renderShell(active, `<div class="page">
    <div class="error-state">
      <span class="empty-icon">${icon('warning', 22)}</span>
      <h1>That did not load</h1>
      <p>${escapeHtml(error.message || 'Unknown error')}</p>
      <button class="btn" type="button" onclick="location.reload()">Reload</button>
    </div>
  </div>`);
}

/* ------------------------------------------------------------------ chat */

async function renderChat(conversationId) {
  const isNew = !conversationId || conversationId === 'new';
  const serial = state.routeSerial;
  const [projectData, skillData, conversationData] = await Promise.all([
    api.projects(),
    api.skills(),
    api.conversations()
  ]);
  let detail = null;
  if (!isNew) {
    detail = await api.conversation(conversationId);
    if (serial !== state.routeSerial) return;
  }
  if (serial !== state.routeSerial) return;

  const projects = projectData.projects;
  const skills = skillData.skills;
  const conversation = detail?.conversation || null;
  let selectedProject = conversation?.projectId || '';
  if (isNew) {
    const pendingProject = sessionStorage.getItem('harness.newChatProject');
    sessionStorage.removeItem('harness.newChatProject');
    if (pendingProject && projects.some((project) => project.id === pendingProject)) {
      selectedProject = pendingProject;
    }
  }
  const selectedSkill = conversation?.skillId || '';
  const thinking = conversation?.thinking || false;
  const title = conversation?.title || 'New chat';
  const messages = detail?.messages || [];
  const conversations = conversationData.conversations;
  const provider = state.boot?.state?.provider;

  state.chat = {
    id: conversation?.id || null,
    detail,
    projectId: selectedProject,
    skillId: selectedSkill,
    thinking,
    serial
  };
  state.copyMap = new Map();

  const chatList = conversations.length
    ? conversations
        .map((item) => {
          const active = item.id === conversation?.id;
          const project = projects.find((entry) => entry.id === item.projectId);
          return `<div class="chat-item ${active ? 'active' : ''}" data-chat-text="${escapeHtml(`${item.title} ${item.preview || ''}`.toLowerCase())}">
            <a href="#/chat/${item.id}" class="chat-item-link">
              <span class="chat-item-title">${escapeHtml(item.title || 'Untitled chat')}</span>
              <span class="chat-item-preview">${escapeHtml(truncate(item.preview || 'No messages yet', 70))}</span>
              <span class="chat-item-meta">${project ? `<span class="project-dot"></span>${escapeHtml(project.name)} · ` : ''}${timeAgo(item.updatedAt)}</span>
            </a>
            <button class="icon-btn tiny chat-item-delete" type="button" data-delete-chat="${item.id}" aria-label="Delete chat">${icon('trash', 14)}</button>
          </div>`;
        })
        .join('')
    : `<p class="chat-list-empty">No chats yet. Start one.</p>`;

  const content = `<div class="chat-layout">
    <aside class="chat-list" id="chat-list">
      <div class="chat-list-head">
        <span>Chats</span>
        <a class="icon-btn" href="#/chat/new" title="New chat" aria-label="New chat">${icon('plus', 16)}</a>
      </div>
      <label class="chat-filter">
        ${icon('search', 14)}
        <input id="chat-filter" type="search" placeholder="Filter chats" autocomplete="off">
      </label>
      <div class="chat-list-items" id="chat-list-items">${chatList}</div>
    </aside>

    <section class="chat-main">
      <header class="chat-topbar">
        <button class="icon-btn chat-list-toggle" id="chat-list-toggle" type="button" aria-label="Show chats">${icon('menu', 19)}</button>
        <div class="chat-heading">
          <h1 id="chat-title">${escapeHtml(isNew ? 'New chat' : title)}</h1>
          <p id="chat-subtitle">${isNew ? 'No project' : `${messages.length} ${messages.length === 1 ? 'message' : 'messages'}${conversation?.projectId ? ` · ${escapeHtml(projects.find((p) => p.id === conversation.projectId)?.name || 'Project')}` : ''}`}</p>
        </div>
        <div class="chat-top-actions">
          ${provider ? `<span class="provider-label ${provider.name === 'demo' ? 'warn' : ''}">${escapeHtml(provider.name === 'demo' ? 'Offline demo' : provider.model)}</span>` : ''}
          ${conversation ? `<button class="icon-btn" type="button" id="delete-chat" aria-label="Delete chat">${icon('trash', 16)}</button>` : ''}
        </div>
      </header>

      <div class="chat-scroll" id="chat-scroll">
        ${isNew ? emptyChat() : `<div class="messages" id="messages">${messages.map((message) => messageHtml(message, detail.artifacts)).join('')}</div>`}
      </div>

      <div class="composer-wrap">
        <div class="chat-error" id="chat-error" hidden></div>
        <form class="composer" id="composer-form">
          <textarea id="composer-input" rows="1" placeholder="${conversation ? 'Reply, or ask for something new…' : 'Ask anything, or describe what you want to build…'}" aria-label="Message"></textarea>
          <div class="composer-bar">
            <div class="composer-controls">
              <label class="control-select" title="Project context">
                <span>Project</span>
                <select id="project-select">
                  <option value="">None</option>
                  ${projects.map((project) => `<option value="${project.id}" ${project.id === selectedProject ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}
                </select>
              </label>
              <label class="control-select" title="Skill instructions">
                <span>Skill</span>
                <select id="skill-select">
                  <option value="">None</option>
                  ${skills.map((skill) => `<option value="${skill.id}" ${skill.id === selectedSkill ? 'selected' : ''}>${escapeHtml(skill.name)}</option>`).join('')}
                </select>
              </label>
              <button class="chip ${thinking ? 'on' : ''}" type="button" id="thinking-toggle" aria-pressed="${thinking}">
                ${icon('brain', 14)} Think
              </button>
            </div>
            <div class="composer-actions">
              <span class="composer-hint">Enter to send · Shift+Enter for a new line</span>
              <button class="send-btn" type="submit" id="send-btn" aria-label="Send message">${icon('send', 19)}</button>
            </div>
          </div>
        </form>
        <p class="composer-foot"><span>Local-first. Only model calls leave this machine.</span><span>${escapeHtml(state.boot?.harnessName || 'Agent Harness')}</span></p>
      </div>
    </section>
  </div>`;

  app.innerHTML = renderShell('chat', content);

  const messagesEl = document.querySelector('#messages');
  const scrollEl = document.querySelector('#chat-scroll');
  const input = document.querySelector('#composer-input');
  const form = document.querySelector('#composer-form');
  const sendButton = document.querySelector('#send-btn');
  const errorBox = document.querySelector('#chat-error');
  const projectSelect = document.querySelector('#project-select');
  const skillSelect = document.querySelector('#skill-select');
  const thinkingButton = document.querySelector('#thinking-toggle');

  const scrollToBottom = (force = false) => {
    if (!scrollEl) return;
    const near = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 220;
    if (force || near) scrollEl.scrollTop = scrollEl.scrollHeight;
  };
  if (!isNew) scrollToBottom(true);

  const resize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  };
  input.addEventListener('input', resize);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  resize();

  const currentSettings = async () => ({
    projectId: projectSelect.value || null,
    skillId: skillSelect.value || null,
    thinking: thinkingButton.classList.contains('on')
  });

  projectSelect.addEventListener('change', async () => {
    if (conversation) {
      try {
        await api.updateConversation(conversation.id, { projectId: projectSelect.value || null });
        toast(projectSelect.value ? 'Project attached to this chat.' : 'Project removed.');
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
  skillSelect.addEventListener('change', async () => {
    if (conversation) {
      try {
        await api.updateConversation(conversation.id, { skillId: skillSelect.value || null });
        toast(skillSelect.value ? 'Skill attached to this chat.' : 'Skill removed.');
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
  thinkingButton.addEventListener('click', async () => {
    const next = !thinkingButton.classList.contains('on');
    thinkingButton.classList.toggle('on', next);
    thinkingButton.setAttribute('aria-pressed', String(next));
    if (conversation) {
      try {
        await api.updateConversation(conversation.id, { thinking: next });
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  document.querySelector('#chat-list-toggle')?.addEventListener('click', () => {
    document.querySelector('#chat-list')?.classList.toggle('open');
  });

  document.querySelector('#chat-filter')?.addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('.chat-item').forEach((item) => {
      item.hidden = query && !item.dataset.chatText.includes(query);
    });
  });

  document.querySelector('#delete-chat')?.addEventListener('click', async () => {
    if (!conversation || !confirm('Delete this chat and its messages?')) return;
    await api.deleteConversation(conversation.id);
    location.hash = '#/chat/new';
  });

  document.querySelectorAll('[data-suggestion]').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.dataset.suggestion;
      resize();
      input.focus();
    });
  });

  let creatingConversation = false;
  const sendMessage = async (text) => {
    if (!text.trim() || sendButton.disabled || creatingConversation) return;
    const serialNow = state.routeSerial;
    const settings = await currentSettings();

    if (!conversation) {
      creatingConversation = true;
      sendButton.disabled = true;
      try {
        const { conversation: created } = await api.createConversation(settings);
        sessionStorage.setItem('harness.pendingMessage', text);
        location.hash = `#/chat/${created.id}`;
      } catch (error) {
        toast(error.message, 'error');
        creatingConversation = false;
        sendButton.disabled = false;
      }
      return;
    }

    input.value = '';
    resize();
    sendButton.disabled = true;
    errorBox.hidden = true;
    if (!messagesEl) return;

    messagesEl.insertAdjacentHTML(
      'beforeend',
      `<article class="message user">
        <div class="user-bubble">${renderMarkdown(text)}</div>
        <div class="user-meta">${timeAgo(new Date().toISOString())}</div>
      </article>`
    );

    const streamId = `stream-${Date.now()}`;
    messagesEl.insertAdjacentHTML(
      'beforeend',
      `<article class="message assistant" id="${streamId}">
        <div class="assistant-head">
          <span class="assistant-avatar">A</span>
          <span class="assistant-name">Assistant</span>
          <span class="message-provider">${escapeHtml(state.boot?.state?.provider?.model || 'model')}</span>
          <span class="message-time">now</span>
        </div>
        <details class="reasoning" hidden>
          <summary>${icon('brain', 14)} Reasoning <span class="reasoning-count"></span></summary>
          <div class="reasoning-body"></div>
        </details>
        <div class="message-content streaming-content"><span class="typing"><i></i><i></i><i></i></span><span class="stream-text"></span><span class="building-artifact" hidden>Building artifact…</span></div>
      </article>`
    );
    scrollToBottom(true);

    const streamEl = document.querySelector(`#${streamId}`);
    const reasoningEl = streamEl.querySelector('.reasoning');
    const reasoningBody = streamEl.querySelector('.reasoning-body');
    const reasoningCount = streamEl.querySelector('.reasoning-count');
    const textEl = streamEl.querySelector('.stream-text');
    const buildingEl = streamEl.querySelector('.building-artifact');
    const typingEl = streamEl.querySelector('.typing');
    const abort = new AbortController();
    state.stream = { abort, conversationId: conversation.id };

    let raw = '';
    let reasoning = '';
    const update = () => {
      const artifactAt = raw.search(/```(?:html|svg)\s+artifact=/i);
      const visible = artifactAt === -1 ? raw : raw.slice(0, artifactAt);
      textEl.textContent = visible;
      buildingEl.hidden = artifactAt === -1;
      typingEl.hidden = raw.length > 0 || reasoning.length > 0;
      scrollToBottom();
    };

    try {
      await streamChat(
        conversation.id,
        { content: text, ...settings },
        {
          start: (data) => {
            if (serialNow !== state.routeSerial) return;
            const titleEl = document.querySelector('#chat-title');
            if (titleEl && data.title) titleEl.textContent = data.title;
          },
          reasoning: (data) => {
            reasoning += data.delta;
            reasoningEl.hidden = false;
            reasoningEl.open = true;
            reasoningBody.textContent = reasoning;
            reasoningCount.textContent = `${reasoning.length.toLocaleString()} chars`;
            update();
          },
          text: (data) => {
            raw += data.delta;
            update();
          },
          memory: (data) => {
            toast(`Remembered: ${truncate(data.content, 90)}`, 'success');
          },
          artifact: (data) => {
            buildingEl.textContent = `Building “${data.title}”…`;
          }
        },
        abort.signal
      );

      if (serialNow !== state.routeSerial) return;
      const refreshed = await api.conversation(conversation.id);
      if (serialNow !== state.routeSerial) return;
      await refreshChatMessages(refreshed, { replaceMessages: true });
    } catch (error) {
      if (abort.signal.aborted) return;
      if (serialNow !== state.routeSerial) return;
      streamEl.remove();
      errorBox.hidden = false;
      errorBox.innerHTML = `<strong>Generation failed.</strong> ${escapeHtml(error.message)}`;
      toast(error.message, 'error');
      try {
        const refreshed = await api.conversation(conversation.id);
        await refreshChatMessages(refreshed, { replaceMessages: true, keepUser: true });
      } catch {
        // The message is already visible; no need to surface a second failure.
      }
    } finally {
      if (state.stream?.abort === abort) state.stream = null;
      if (serialNow === state.routeSerial) {
        sendButton.disabled = false;
        input.focus();
      }
    }
  };

  async function refreshChatMessages(refreshed, { replaceMessages = false } = {}) {
    state.chat.detail = refreshed;
    state.copyMap = new Map();
    if (replaceMessages && messagesEl) {
      messagesEl.innerHTML = refreshed.messages
        .map((message) => messageHtml(message, refreshed.artifacts))
        .join('');
    }
    const titleEl = document.querySelector('#chat-title');
    if (titleEl) titleEl.textContent = refreshed.conversation.title;
    const subtitle = document.querySelector('#chat-subtitle');
    if (subtitle) {
      const project = projects.find((entry) => entry.id === refreshed.conversation.projectId);
      subtitle.textContent = `${refreshed.messages.length} ${refreshed.messages.length === 1 ? 'message' : 'messages'}${project ? ` · ${project.name}` : ''}`;
    }
    scrollToBottom(true);
    const listResponse = await api.conversations();
    const items = document.querySelector('#chat-list-items');
    if (items) {
      items.innerHTML = listResponse.conversations
        .map((item) => {
          const project = projects.find((entry) => entry.id === item.projectId);
          return `<div class="chat-item ${item.id === refreshed.conversation.id ? 'active' : ''}">
            <a href="#/chat/${item.id}" class="chat-item-link">
              <span class="chat-item-title">${escapeHtml(item.title || 'Untitled chat')}</span>
              <span class="chat-item-preview">${escapeHtml(truncate(item.preview || 'No messages yet', 70))}</span>
              <span class="chat-item-meta">${project ? `<span class="project-dot"></span>${escapeHtml(project.name)} · ` : ''}${timeAgo(item.updatedAt)}</span>
            </a>
            <button class="icon-btn tiny chat-item-delete" type="button" data-delete-chat="${item.id}" aria-label="Delete chat">${icon('trash', 14)}</button>
          </div>`;
        })
        .join('');
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await sendMessage(input.value);
  });

  const draft = sessionStorage.getItem('harness.draft');
  if (draft) {
    sessionStorage.removeItem('harness.draft');
    input.value = draft;
    resize();
    input.focus();
  }

  const pending = sessionStorage.getItem('harness.pendingMessage');
  if (pending && !isNew) {
    sessionStorage.removeItem('harness.pendingMessage');
    await sendMessage(pending);
  }
}

function emptyChat() {
  const demo = state.boot?.state?.demo;
  return `<div class="empty-chat">
    <div class="empty-chat-inner">
      <span class="empty-orb" aria-hidden="true">${icon('sparkles', 26)}</span>
      <p class="eyebrow">Local-first agent harness</p>
      <h1>What should we make?</h1>
      <p class="empty-lede">Chat with a model, attach project context and skills, then keep what it builds. Artifacts run in a sandbox and stay on this machine.</p>
      <div class="suggestion-grid">
        ${SUGGESTIONS.map(
          (suggestion) => `<button class="suggestion" type="button" data-suggestion="${escapeHtml(suggestion.prompt)}">
            <span class="suggestion-icon">${icon(suggestion.icon, 18)}</span>
            <strong>${suggestion.title}</strong>
            <span>${suggestion.copy}</span>
          </button>`
        ).join('')}
      </div>
      ${demo ? `<div class="demo-banner">${icon('warning', 17)}<span><strong>Offline demo.</strong> Replies are canned so the whole harness is clickable. Connect a model in <a href="#/settings">Settings</a> for real answers.</span></div>` : ''}
    </div>
  </div>`;
}

function messageHtml(message, artifacts = []) {
  state.copyMap.set(message.id, message.content);
  if (message.role === 'user') {
    return `<article class="message user">
      <div class="user-bubble">${renderMarkdown(message.content)}</div>
      <div class="user-meta">${formatDateTime(message.createdAt)}</div>
    </article>`;
  }
  const meta = message.meta || {};
  const artifactIds = Array.isArray(meta.artifactIds) ? meta.artifactIds : [];
  const related = artifactIds
    .map((artifactId) => artifacts.find((artifact) => artifact.id === artifactId))
    .filter(Boolean);
  return `<article class="message assistant">
    <div class="assistant-head">
      <span class="assistant-avatar">A</span>
      <span class="assistant-name">Assistant</span>
      ${meta.provider ? `<span class="message-provider">${meta.provider === 'demo' ? 'Offline demo' : `${escapeHtml(meta.provider)}${meta.model ? ` · ${escapeHtml(meta.model)}` : ''}`}</span>` : ''}
      <span class="message-time">${timeAgo(message.createdAt)}</span>
      <button class="icon-btn tiny copy-message" type="button" data-copy-id="${message.id}" title="Copy reply" aria-label="Copy reply">${icon('copy', 14)}</button>
    </div>
    ${message.reasoning ? `<details class="reasoning"><summary>${icon('brain', 14)} Reasoning <span>${message.reasoning.length.toLocaleString()} chars</span></summary><div class="reasoning-body">${escapeHtml(message.reasoning)}</div></details>` : ''}
    <div class="message-content">${renderMarkdown(message.content)}</div>
    ${related.length ? `<div class="artifact-row">${related.map(artifactTile).join('')}</div>` : ''}
  </article>`;
}

function artifactTile(artifact) {
  return `<button class="artifact-tile" type="button" data-artifact-open="${artifact.id}">
    <span class="artifact-tile-icon">${icon(artifact.kind === 'svg' ? 'image' : 'grid', 18)}</span>
    <span class="artifact-tile-copy"><strong>${escapeHtml(artifact.title)}</strong><small>${artifact.kind.toUpperCase()} artifact · open preview</small></span>
    ${icon('arrowRight', 16)}
  </button>`;
}

/* ------------------------------------------------------------------ projects */

async function renderProjects() {
  const serial = state.routeSerial;
  const { projects } = await api.projects();
  if (serial !== state.routeSerial) return;
  const cards = projects.length
    ? projects
        .map(
          (project) => `<a class="project-card" href="#/projects/${project.id}">
            <div class="project-card-top">
              <span class="folder-mark">${icon('folder', 20)}</span>
              <span class="project-count">${plural(project.conversationCount || 0, 'chat')}</span>
            </div>
            <h2>${escapeHtml(project.name)}</h2>
            <p>${escapeHtml(truncate(project.description || project.instructions || 'No description yet.', 120))}</p>
            <div class="project-card-foot">
              <span>${plural(project.documentCount || 0, 'document')}</span>
              <span>${timeAgo(project.updatedAt)}</span>
            </div>
          </a>`
        )
        .join('')
    : emptyBlock(
        'folder',
        'No projects yet',
        'A project holds fixed instructions and reference documents that every chat in it can see.',
        `<button class="btn" type="button" id="empty-new-project">Create a project</button>`
      );

  app.innerHTML = renderShell(
    'projects',
    `<div class="page">
      ${pageHead({
        eyebrow: 'Context that persists',
        title: 'Projects',
        subtitle: 'One set of instructions and reference documents, shared by every chat in the project.',
        actions: `<button class="btn" type="button" id="new-project">${icon('plus', 16)} New project</button>`
      })}
      <div class="project-grid">${cards}</div>
    </div>`
  );

  document.querySelector('#new-project')?.addEventListener('click', () => openProjectModal());
  document.querySelector('#empty-new-project')?.addEventListener('click', () => openProjectModal());
}

function openProjectModal(project = null) {
  const modal = openModal({
    eyebrow: project ? 'Edit project' : 'New project',
    title: project ? project.name : 'Create a project',
    body: `<form id="project-modal-form" class="form">
      <label>Name<input name="name" required maxlength="80" value="${escapeHtml(project?.name || '')}" placeholder="AI newsletter"></label>
      <label>Description <span class="label-hint">Optional</span><input name="description" maxlength="1000" value="${escapeHtml(project?.description || '')}" placeholder="What this project is for"></label>
      <label>Fixed instructions <span class="label-hint">Sent with every chat in this project</span><textarea name="instructions" rows="9" maxlength="30000" placeholder="You are my research assistant...">${escapeHtml(project?.instructions || '')}</textarea></label>
      <div class="form-actions"><button class="btn ghost" type="button" data-modal-close>Cancel</button><button class="btn" type="submit">${project ? 'Save project' : 'Create project'}</button></div>
    </form>`
  });
  const form = modal.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    setBusy(button, true);
    try {
      const payload = {
        name: form.elements.name.value,
        description: form.elements.description.value,
        instructions: form.elements.instructions.value
      };
      const result = project ? await api.updateProject(project.id, payload) : await api.createProject(payload);
      await refreshBoot();
      closeModal();
      toast(project ? 'Project saved.' : 'Project created.', 'success');
      if (project) route();
      else location.hash = `#/projects/${result.project.id}`;
    } catch (error) {
      formError(form, error.message);
      setBusy(button, false);
    }
  });
}

async function renderProjectDetail(projectId) {
  const serial = state.routeSerial;
  const data = await api.project(projectId);
  if (serial !== state.routeSerial) return;
  const { project, documents, conversations } = data;

  const documentItems = documents.length
    ? documents
        .map(
          (document) => `<div class="document-row">
            <span class="document-icon">${icon('book', 16)}</span>
            <div class="document-copy"><strong>${escapeHtml(document.name)}</strong><small>${document.content.length.toLocaleString()} chars · ${formatDate(document.createdAt)}</small></div>
            <button class="icon-btn tiny" type="button" data-delete-document="${document.id}" aria-label="Delete document">${icon('trash', 14)}</button>
          </div>`
        )
        .join('')
    : `<p class="muted small">No documents yet. Text, Markdown, CSV, and JSON work; the MVP does not parse PDFs or Word files.</p>`;

  app.innerHTML = renderShell(
    'projects',
    `<div class="page">
      <a class="back-link" href="#/projects">${icon('arrowLeft', 15)} All projects</a>
      <header class="detail-head">
        <div>
          <p class="eyebrow">Project</p>
          <h1>${escapeHtml(project.name)}</h1>
          <p class="page-sub">${escapeHtml(project.description || 'No description.')}</p>
        </div>
        <div class="page-actions">
          <button class="btn ghost danger-text" type="button" id="delete-project">${icon('trash', 15)} Delete</button>
          <a class="btn" href="#/chat/new" id="project-new-chat">${icon('plus', 16)} New chat</a>
        </div>
      </header>

      <div class="two-col">
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Fixed instructions</h2><span class="panel-note">Sent with every chat</span></div>
            <form id="project-form" class="form">
              <label>Name<input name="name" required maxlength="80" value="${escapeHtml(project.name)}"></label>
              <label>Description<input name="description" maxlength="1000" value="${escapeHtml(project.description)}"></label>
              <label>Instructions<textarea name="instructions" rows="12" maxlength="30000">${escapeHtml(project.instructions)}</textarea></label>
              <div class="form-actions"><button class="btn" type="submit">Save instructions</button></div>
            </form>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Reference documents</h2>
              <button class="btn ghost small" type="button" id="add-document">${icon('plus', 15)} Add</button>
            </div>
            <p class="panel-lead">Included in the system context for every chat in this project. Keep them focused; the harness truncates long documents.</p>
            <div class="document-list">${documentItems}</div>
          </section>
        </div>

        <aside class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Chats</h2><span class="panel-note">${plural(conversations.length, 'chat')}</span></div>
            ${
              conversations.length
                ? `<div class="mini-list">${conversations
                    .map(
                      (conversation) => `<a class="mini-row" href="#/chat/${conversation.id}">
                        <div><strong>${escapeHtml(conversation.title)}</strong><small>${timeAgo(conversation.updatedAt)}</small></div>
                        ${icon('arrowRight', 15)}
                      </a>`
                    )
                    .join('')}</div>`
                : `<p class="muted small">No chats in this project yet.</p>`
            }
          </section>
          <section class="panel muted-panel">
            <h2>How context works</h2>
            <p class="small">Project instructions and document text are injected ahead of the conversation. Memory and the selected skill are added too. You can inspect the assembled prompt on the <a href="#/instructions">Instructions</a> page.</p>
          </section>
        </aside>
      </div>
    </div>`
  );

  document.querySelector('#project-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    setBusy(button, true);
    try {
      await api.updateProject(projectId, {
        name: form.elements.name.value,
        description: form.elements.description.value,
        instructions: form.elements.instructions.value
      });
      await refreshBoot();
      toast('Project saved.', 'success');
      route();
    } catch (error) {
      formError(form, error.message);
      setBusy(button, false);
    }
  });

  document.querySelector('#project-new-chat').addEventListener('click', () => {
    sessionStorage.setItem('harness.newChatProject', projectId);
  });

  document.querySelector('#add-document').addEventListener('click', () => openDocumentModal(projectId));

  document.querySelectorAll('[data-delete-document]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this document from the project?')) return;
      await api.deleteDocument(projectId, button.dataset.deleteDocument);
      toast('Document deleted.');
      route();
    });
  });

  document.querySelector('#delete-project').addEventListener('click', async () => {
    if (!confirm(`Delete “${project.name}”? Its chats will be kept but detached from the project.`)) return;
    await api.deleteProject(projectId);
    toast('Project deleted.');
    location.hash = '#/projects';
  });
}

function openDocumentModal(projectId) {
  const modal = openModal({
    eyebrow: 'Reference document',
    title: 'Add a document',
    body: `<form id="document-form" class="form">
      <label>Name<input name="name" required maxlength="160" placeholder="Brand voice.md"></label>
      <label class="file-input-label">Load a text file <span class="label-hint">.md, .txt, .csv, .json</span>
        <input type="file" id="document-file" accept=".md,.txt,.csv,.json,.html,text/*,application/json">
      </label>
      <label>Content<textarea name="content" rows="12" required maxlength="300000" placeholder="Paste the document text here…"></textarea></label>
      <div class="form-actions"><button class="btn ghost" type="button" data-modal-close>Cancel</button><button class="btn" type="submit">Add document</button></div>
    </form>`
  });
  const form = modal.querySelector('form');
  modal.querySelector('#document-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      form.elements.content.value = text;
      if (!form.elements.name.value) form.elements.name.value = file.name.replace(/\.[^.]+$/, '');
    } catch (error) {
      formError(form, error.message);
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    setBusy(button, true);
    try {
      await api.addDocument(projectId, {
        name: form.elements.name.value,
        content: form.elements.content.value
      });
      closeModal();
      toast('Document added.', 'success');
      route();
    } catch (error) {
      formError(form, error.message);
      setBusy(button, false);
    }
  });
}

/* ------------------------------------------------------------------ memory */

async function renderMemory() {
  const serial = state.routeSerial;
  const [{ memories }, boot] = await Promise.all([api.memories(), api.state()]);
  if (serial !== state.routeSerial) return;
  state.boot = { ...state.boot, state: boot };

  const groups = ['fact', 'preference', 'project', 'person'];
  const labels = { fact: 'Facts', preference: 'Preferences', project: 'Projects', person: 'People' };
  const rows = groups
    .map((category) => {
      const entries = memories.filter((memory) => memory.category === category);
      if (!entries.length) return '';
      return `<section class="memory-group">
        <div class="group-head"><h2>${labels[category]}</h2><span>${entries.length}</span></div>
        ${entries
          .map(
            (memory) => `<div class="memory-row">
              <p>${escapeHtml(memory.content)}</p>
              <div class="memory-meta"><span>${timeAgo(memory.updatedAt)}</span>
                <button class="icon-btn tiny" type="button" data-edit-memory="${memory.id}" aria-label="Edit memory">${icon('edit', 14)}</button>
                <button class="icon-btn tiny" type="button" data-delete-memory="${memory.id}" aria-label="Delete memory">${icon('trash', 14)}</button>
              </div>
            </div>`
          )
          .join('')}
      </section>`;
    })
    .join('');

  app.innerHTML = renderShell(
    'memory',
    `<div class="page page-narrow">
      ${pageHead({
        eyebrow: 'Persistent context',
        title: 'Memory',
        subtitle: 'Durable facts and preferences. They are injected into every new conversation, and nothing is shared outside this machine.'
      })}
      ${!boot.memoryEnabled ? `<div class="demo-banner">${icon('warning', 17)}<span>Memory is currently disabled in <a href="#/settings">Settings</a>. Saved items are kept but not sent to the model.</span></div>` : ''}
      <section class="panel memory-add">
        <form id="memory-form" class="form">
          <div class="inline-fields">
            <label>Type<select name="category"><option value="fact">Fact</option><option value="preference">Preference</option><option value="project">Project</option><option value="person">Person</option></select></label>
            <label class="grow">Remember this<textarea name="content" rows="2" required maxlength="2000" placeholder="I run a small newsletter about AI infrastructure."></textarea></label>
          </div>
          <div class="form-actions"><button class="btn" type="submit">${icon('plus', 15)} Add memory</button></div>
        </form>
      </section>
      <div class="memory-list">
        ${rows || emptyBlock('brain', 'Nothing remembered yet', 'Add a durable fact, or say “remember that…” in a chat. The assistant can save memories itself.', '')}
      </div>
    </div>`
  );

  const form = document.querySelector('#memory-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    setBusy(button, true);
    try {
      await api.addMemory({
        content: form.elements.content.value,
        category: form.elements.category.value
      });
      toast('Memory saved.', 'success');
      route();
    } catch (error) {
      formError(form, error.message);
      setBusy(button, false);
    }
  });

  document.querySelectorAll('[data-delete-memory]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this memory?')) return;
      await api.deleteMemory(button.dataset.deleteMemory);
      toast('Memory deleted.');
      route();
    });
  });

  document.querySelectorAll('[data-edit-memory]').forEach((button) => {
    button.addEventListener('click', () => {
      const memory = memories.find((entry) => entry.id === button.dataset.editMemory);
      if (memory) openMemoryModal(memory);
    });
  });
}

