import assert from 'node:assert/strict';
import test from 'node:test';
import { collectModel, ProviderError } from '../server/llm.mjs';

function sseResponse(chunks, status = 200) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    }),
    { status, headers: { 'content-type': 'text/event-stream' } }
  );
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const openaiProvider = {
  name: 'openai',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  model: 'gpt-4o-mini'
};

const anthropicProvider = {
  name: 'anthropic',
  baseUrl: 'https://example.test',
  apiKey: 'test-key',
  model: 'claude-sonnet-4-5'
};

test('OpenAI-compatible stream handles reasoning, text, and usage', async () => {
  const original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"Think. "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
      'data: [DONE]\n\n'
    ]);
  };
  try {
    const result = await collectModel({
      provider: openaiProvider,
      system: 'You are a test.',
      messages: [{ role: 'user', content: 'hi' }]
    });
    assert.equal(result.text, 'Hello world');
    assert.equal(result.reasoning, 'Think. ');
    assert.equal(result.usage.total_tokens, 12);
    assert.equal(captured.url, 'https://example.test/v1/chat/completions');
    assert.equal(captured.body.messages[0].role, 'system');
    assert.equal(captured.body.messages[0].content, 'You are a test.');
    assert.equal(captured.body.stream, true);
    assert.equal(captured.body.temperature, 0.7);
    assert.equal(captured.options.headers.authorization, 'Bearer test-key');
  } finally {
    globalThis.fetch = original;
  }
});

test('Anthropic stream sends cached system blocks and thinking budget', async () => {
  const original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return sseResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":0}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Plan. "}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Answer"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]);
  };
  try {
    const result = await collectModel({
      provider: anthropicProvider,
      stable: 'Stable rules.',
      dynamic: 'Project context.',
      messages: [{ role: 'user', content: 'hi' }],
      thinking: true
    });
    assert.equal(result.text, 'Answer');
    assert.equal(result.reasoning, 'Plan. ');
    assert.equal(result.usage.prompt_tokens, 20);
    assert.equal(result.usage.completion_tokens, 5);
    assert.equal(captured.url, 'https://example.test/v1/messages');
    assert.equal(captured.body.system[0].cache_control.type, 'ephemeral');
    assert.equal(captured.body.system[1].cache_control.type, 'ephemeral');
    assert.equal(captured.body.thinking.type, 'enabled');
    assert.equal(captured.body.thinking.budget_tokens, 4096);
    assert.equal(captured.body.max_tokens, 8192);
    assert.equal(captured.options.headers['x-api-key'], 'test-key');
    assert.equal(captured.options.headers['anthropic-version'], '2023-06-01');
  } finally {
    globalThis.fetch = original;
  }
});

test('provider HTTP errors become readable ProviderError messages', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({ error: { message: 'invalid api key' } }, 401);
  try {
    await assert.rejects(
      collectModel({
        provider: openaiProvider,
        system: 'x',
        messages: [{ role: 'user', content: 'hi' }]
      }),
      (error) => {
        assert.ok(error instanceof ProviderError);
        assert.match(error.message, /401/);
        assert.match(error.message, /invalid api key/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('SSE parsing survives events split across chunks', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"con',
      'tent":"split"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" message"}}]}\n\ndata: [DONE]\n\n'
    ]);
  try {
    const result = await collectModel({
      provider: openaiProvider,
      system: 'x',
      messages: [{ role: 'user', content: 'hi' }]
    });
    assert.equal(result.text, 'split message');
  } finally {
    globalThis.fetch = original;
  }
});
