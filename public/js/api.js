async function request(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export const api = {
  state: () => request('/api/state'),
  projects: () => request('/api/projects'),
  project: (id) => request(`/api/projects/${encodeURIComponent(id)}`),
  createProject: (body) => request('/api/projects', { method: 'POST', body }),
  updateProject: (id, body) => request(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteProject: (id) => request(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addDocument: (id, body) => request(`/api/projects/${encodeURIComponent(id)}/documents`, { method: 'POST', body }),
  deleteDocument: (id, documentId) =>
    request(`/api/projects/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }),

  conversations: (projectId) =>
    request(`/api/conversations${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
  conversation: (id) => request(`/api/conversations/${encodeURIComponent(id)}`),
  createConversation: (body) => request('/api/conversations', { method: 'POST', body }),
  updateConversation: (id, body) =>
    request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteConversation: (id) => request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  memories: () => request('/api/memory'),
  addMemory: (body) => request('/api/memory', { method: 'POST', body }),
  updateMemory: (id, body) => request(`/api/memory/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteMemory: (id) => request(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  prompts: () => request('/api/prompts'),
  skills: () => request('/api/skills'),
  createSkill: (body) => request('/api/skills', { method: 'POST', body }),
  updateSkill: (id, body) => request(`/api/skills/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteSkill: (id) => request(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  artifacts: () => request('/api/artifacts?limit=300'),
  artifact: (id) => request(`/api/artifacts/${encodeURIComponent(id)}`),
  deleteArtifact: (id) => request(`/api/artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  tasks: () => request('/api/tasks'),
  task: (id) => request(`/api/tasks/${encodeURIComponent(id)}`),
  createTask: (body) => request('/api/tasks', { method: 'POST', body }),
  updateTask: (id, body) => request(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteTask: (id) => request(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runTask: (id) => request(`/api/tasks/${encodeURIComponent(id)}/run`, { method: 'POST', body: {} }),
  taskRuns: (id) => request(`/api/tasks/${encodeURIComponent(id)}/runs`),

  instructions: () => request('/api/instructions'),
  saveInstructions: (content) => request('/api/instructions', { method: 'PUT', body: { content } }),
  previewContext: (body) => request('/api/context/preview', { method: 'POST', body }),

  settings: () => request('/api/settings'),
  saveSettings: (body) => request('/api/settings', { method: 'PATCH', body }),
  testSettings: () => request('/api/settings/test', { method: 'POST', body: {} })
};

export async function streamChat(conversationId, payload, handlers, signal) {
  let response;
  try {
    response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
  } catch (error) {
    throw error;
  }
  if (!response.ok) {
    const text = await response.text();
    let message = `Request failed (${response.status})`;
    try {
      message = JSON.parse(text).error || message;
    } catch {
      // Keep the fallback.
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const chunk of events) {
      let eventName = 'message';
      const dataLines = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) continue;
      let data;
      try {
        data = JSON.parse(dataLines.join('\n'));
      } catch {
        continue;
      }
      if (eventName === 'error') {
        await reader.cancel().catch(() => {});
        throw new Error(data.message || 'The model request failed.');
      }
      handlers[eventName]?.(data);
    }
  }
}
