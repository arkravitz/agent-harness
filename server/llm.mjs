import { streamDemo } from './demo.mjs';

export class ProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

function trimBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function openAIUrl(baseUrl) {
  const base = trimBase(baseUrl);
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function anthropicUrl(baseUrl) {
  const base = trimBase(baseUrl);
  if (base.endsWith('/v1/messages')) return base;
  if (base.endsWith('/v1')) return `${base}/messages`;
  return `${base}/v1/messages`;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('');
  }
  return '';
}

async function readError(response, providerName) {
  let raw = '';
  try {
    raw = await response.text();
  } catch {
    // Ignore body read failures.
  }
  let message = raw.slice(0, 600);
  try {
    const parsed = JSON.parse(raw);
    message = parsed?.error?.message || parsed?.message || message;
  } catch {
    // Keep the raw text.
  }
  return new ProviderError(
    `${providerName} returned HTTP ${response.status}${message ? `: ${message}` : ''}`,
    response.status
  );
}

async function* sseEvents(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const dataLines = [];
      let eventName = null;
      for (const line of part.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) continue;
      const data = dataLines.join('\n');
      if (data === '[DONE]') return;
      yield { event: eventName, data };
    }
  }
  if (buffer.trim()) {
    const dataLines = [];
    let eventName = null;
    for (const line of buffer.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length) yield { event: eventName, data: dataLines.join('\n') };
  }
}

async function* streamOpenAI({ provider, system, messages, thinking, signal }) {
  const isReasoningModel =
    /^(o[1-9](\b|-)|gpt-5)/i.test(provider.model) || /reasoner|reasoning/i.test(provider.model);
  const body = {
    model: provider.model,
    messages: [{ role: 'system', content: system }, ...messages],
    stream: true
  };
  const isReasoner = /reasoner/i.test(provider.model);
  if (isReasoningModel && !isReasoner) {
    body.reasoning_effort = thinking ? 'high' : 'medium';
  } else if (!isReasoner) {
    body.temperature = 0.7;
  }
  if (isReasoningModel) {
    body.max_completion_tokens = thinking ? 8192 : 4096;
  } else {
    body.max_tokens = thinking ? 8192 : 4096;
  }

  let response;
  try {
    response = await fetch(openAIUrl(provider.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: withTimeout(signal, 180_000)
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ProviderError(`Could not reach the OpenAI-compatible endpoint: ${error.message}`);
  }
  if (!response.ok) throw await readError(response, 'OpenAI-compatible endpoint');

  let usage = null;
  for await (const message of sseEvents(response)) {
    let payload;
    try {
      payload = JSON.parse(message.data);
    } catch {
      continue;
    }
    if (payload?.error) {
      throw new ProviderError(payload.error.message || 'The model provider returned an error.');
    }
    const choice = payload?.choices?.[0];
    if (choice) {
      const delta = choice.delta || {};
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) yield { type: 'thinking', delta: String(reasoning) };
      const text = textFromContent(delta.content);
      if (text) yield { type: 'text', delta: text };
    }
    if (payload?.usage) {
      usage = {
        prompt_tokens: payload.usage.prompt_tokens ?? 0,
        completion_tokens: payload.usage.completion_tokens ?? 0,
        total_tokens: payload.usage.total_tokens ?? 0
      };
    }
  }
  if (usage) yield { type: 'usage', usage };
}

async function* streamAnthropic({ provider, stable, dynamic, messages, thinking, signal }) {
  const system = [{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }];
  if (dynamic) {
    system.push({ type: 'text', text: dynamic, cache_control: { type: 'ephemeral' } });
  }
  const body = {
    model: provider.model,
    max_tokens: thinking ? 8192 : 4096,
    system,
    messages,
    stream: true
  };
  if (thinking) {
    body.thinking = { type: 'enabled', budget_tokens: 4096 };
  } else {
    body.temperature = 0.7;
  }

  let response;
  try {
    response = await fetch(anthropicUrl(provider.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: withTimeout(signal, 180_000)
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ProviderError(`Could not reach the Anthropic endpoint: ${error.message}`);
  }
  if (!response.ok) throw await readError(response, 'Anthropic');

  let usage = null;
  for await (const message of sseEvents(response)) {
    let payload;
    try {
      payload = JSON.parse(message.data);
    } catch {
      continue;
    }
    if (payload.type === 'error') {
      throw new ProviderError(payload.error?.message || 'Anthropic returned an error.');
    }
    if (payload.type === 'content_block_delta') {
      const delta = payload.delta || {};
      if (delta.type === 'thinking_delta' && delta.thinking) {
        yield { type: 'thinking', delta: delta.thinking };
      }
      if (delta.type === 'text_delta' && delta.text) {
        yield { type: 'text', delta: delta.text };
      }
    }
    if (payload.type === 'message_start' && payload.message?.usage) {
      usage = {
        prompt_tokens: payload.message.usage.input_tokens ?? 0,
        completion_tokens: payload.message.usage.output_tokens ?? 0,
        total_tokens: (payload.message.usage.input_tokens ?? 0) + (payload.message.usage.output_tokens ?? 0),
        cache_read_input_tokens: payload.message.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: payload.message.usage.cache_creation_input_tokens ?? 0
      };
    }
    if (payload.type === 'message_delta' && payload.usage) {
      usage = {
        ...(usage || {}),
        completion_tokens: payload.usage.output_tokens ?? usage?.completion_tokens ?? 0,
        total_tokens: (usage?.prompt_tokens ?? 0) + (payload.usage.output_tokens ?? 0)
      };
    }
  }
  if (usage) yield { type: 'usage', usage };
}

/**
 * The single streaming interface used by chat and scheduled tasks.
 * Yields {type: 'text'|'thinking'|'usage', ...}.
 */
export async function* streamModel({ provider, system, stable, dynamic, messages, thinking = false, signal, demoFast = false }) {
  if (provider.name === 'demo') {
    yield* streamDemo({ messages, thinking, fast: demoFast, signal });
    return;
  }
  if (provider.name === 'anthropic') {
    yield* streamAnthropic({
      provider,
      stable: stable ?? system,
      dynamic: dynamic ?? '',
      messages,
      thinking,
      signal
    });
    return;
  }
  yield* streamOpenAI({ provider, system, messages, thinking, signal });
}

export async function collectModel(options) {
  let text = '';
  let reasoning = '';
  let usage = null;
  for await (const event of streamModel(options)) {
    if (event.type === 'text') text += event.delta;
    else if (event.type === 'thinking') reasoning += event.delta;
    else if (event.type === 'usage') usage = event.usage;
  }
  return { text, reasoning, usage };
}

async function testOpenAI(provider) {
  const started = Date.now();
  const response = await fetch(openAIUrl(provider.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      max_tokens: 8
    }),
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) throw await readError(response, 'OpenAI-compatible endpoint');
  const data = await response.json();
  return {
    ok: true,
    provider: 'openai',
    model: provider.model,
    latencyMs: Date.now() - started,
    message: textFromContent(data?.choices?.[0]?.message?.content).trim().slice(0, 80) || 'Connected.'
  };
}

async function testAnthropic(provider) {
  const started = Date.now();
  const response = await fetch(anthropicUrl(provider.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }]
    }),
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) throw await readError(response, 'Anthropic');
  const data = await response.json();
  return {
    ok: true,
    provider: 'anthropic',
    model: provider.model,
    latencyMs: Date.now() - started,
    message: textFromContent(data?.content).trim().slice(0, 80) || 'Connected.'
  };
}

export async function testProvider(provider) {
  if (provider.name === 'demo') {
    return { ok: true, provider: 'demo', model: 'offline demo', latencyMs: 0, message: 'Demo mode needs no connection.' };
  }
  try {
    return provider.name === 'anthropic' ? await testAnthropic(provider) : await testOpenAI(provider);
  } catch (error) {
    return {
      ok: false,
      provider: provider.name,
      model: provider.model,
      latencyMs: null,
      message: error.message
    };
  }
}
