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

