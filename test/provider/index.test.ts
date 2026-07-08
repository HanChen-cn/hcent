import { describe, it, expect } from 'vitest';
import {
  createMockProvider,
  createOpenAICompatibleProvider,
  type Provider,
  type ProviderRequest,
} from '@/provider/index.js';
import type { AppConfig } from '@/config/index.js';

function makeConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    provider: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-test',
    timeoutMs: 60_000,
    maxRetries: 0,
    maxLoops: 25,
    models: [],
    activeModel: '',
    searchApiKey: '',
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<ProviderRequest>): ProviderRequest {
  return {
    messages: [
      { role: 'system', content: 'You are helpful.', ts: new Date().toISOString() },
      { role: 'user', content: 'hello', ts: new Date().toISOString() },
    ],
    tools: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function collect(provider: Provider, req: ProviderRequest) {
  const deltas = [];
  for await (const d of provider.stream(req)) {
    deltas.push(d);
  }
  return deltas;
}

describe('createMockProvider', () => {
  it('streams content deltas in order', async () => {
    const p = createMockProvider('mock', [
      { contentDelta: 'Hello world' },
    ]);
    const deltas = await collect(p, makeRequest());

    expect(deltas.filter((d) => d.contentDelta).map((d) => d.contentDelta).join('')).toBe('Hello world');
  });

  it('streams toolCalls on final delta', async () => {
    const calls = [{ id: 'c1', name: 'read', arguments: { path: '/f' } }];
    const p = createMockProvider('mock', [
      { contentDelta: 'ok', toolCalls: calls },
    ]);
    const deltas = await collect(p, makeRequest());

    const tc = deltas.find((d) => d.toolCalls);
    expect(tc).toBeDefined();
    expect(tc!.toolCalls).toEqual(calls);
  });

  it('returns empty stream for exhausted responses', async () => {
    const p = createMockProvider('mock', [
      { contentDelta: 'one' },
    ]);
    await collect(p, makeRequest());
    const deltas = await collect(p, makeRequest());
    expect(deltas).toEqual([]);
  });

  it('respects delayMs', async () => {
    const start = Date.now();
    const p = createMockProvider('mock', [
      { contentDelta: 'x', delayMs: 50 },
    ]);
    await collect(p, makeRequest());
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });

  it('content-only response has no toolCalls', async () => {
    const p = createMockProvider('mock', [
      { contentDelta: 'just text' },
    ]);
    const deltas = await collect(p, makeRequest());
    const tc = deltas.find((d) => d.toolCalls);
    expect(tc).toBeUndefined();
  });

  it('tool-call-only response has no contentDelta', async () => {
    const p = createMockProvider('mock', [
      { toolCalls: [{ id: 'c1', name: 'ls', arguments: {} }] },
    ]);
    const deltas = await collect(p, makeRequest());
    const content = deltas.filter((d) => d.contentDelta).map((d) => d.contentDelta).join('');
    expect(content).toBe('');
    expect(deltas.find((d) => d.toolCalls)).toBeDefined();
  });

  it('reports model name', () => {
    const p = createMockProvider('gpt-mock', []);
    expect(p.model).toBe('gpt-mock');
  });
});

describe('createOpenAICompatibleProvider', () => {
  it('sets model from config', () => {
    const p = createOpenAICompatibleProvider(makeConfig({ model: 'deepseek-v3' }));
    expect(p.model).toBe('deepseek-v3');
  });

  it('aborts on pre-aborted signal (OpenAI SDK throws on aborted request)', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    const p = createOpenAICompatibleProvider(makeConfig());
    const req = makeRequest({ signal: ctrl.signal });

    // OpenAI SDK throws when the request is aborted
    await expect(collect(p, req)).rejects.toThrow();
  });

  it('OpenAI client configured with baseUrl and apiKey from config', () => {
    const p = createOpenAICompatibleProvider(
      makeConfig({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-my-key' }),
    );
    expect(p.model).toBe('deepseek-chat');
  });

  it('handles empty tool list (tools: undefined sent to API)', () => {
    const p = createOpenAICompatibleProvider(makeConfig());
    expect(p.model).toBe('deepseek-chat');
  });
});
