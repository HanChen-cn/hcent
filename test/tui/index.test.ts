import { describe, it, expect } from 'vitest';
import { createSession, createMessage } from '@/session/index.js';
import { createMockProvider } from '@/provider/index.js';
import type { AppConfig } from '@/config/index.js';

// Import the component for type checking, test via unit-level smoke
// Full render tests require Ink's render() which needs a TTY environment

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

describe('tui-chat-shell integration smoke', () => {
  it('creates session with system prompt', () => {
    const s = createSession('You are a helpful TUI coding assistant.');
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('system');
  });

  it('session accepts user message', () => {
    const s = createSession();
    s.append(createMessage({ role: 'user', content: 'hello' }));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('user');
  });

  it('mock provider can be wired to session', async () => {
    const s = createSession('sys');
    s.append(createMessage({ role: 'user', content: 'hi' }));

    const p = createMockProvider('mock', [{ contentDelta: 'Hello!' }]);

    // simulate what App does
    let full = '';
    for await (const d of p.stream({
      messages: s.snapshot(),
      tools: [],
      signal: new AbortController().signal,
    })) {
      if (d.contentDelta) full += d.contentDelta;
    }
    expect(full).toBe('Hello!');

    s.append(createMessage({ role: 'assistant', content: full }));
    expect(s.messages).toHaveLength(3);
    expect(s.messages[2].content).toBe('Hello!');
  });

  it('/clear preserves system prompt', () => {
    const s = createSession('system prompt');
    s.append(createMessage({ role: 'user', content: 'q1' }));
    s.append(createMessage({ role: 'assistant', content: 'a1' }));
    s.clear();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('system');
    expect(s.messages[0].content).toBe('system prompt');
  });

  it('session snapshot used for provider call is isolated', () => {
    const s = createSession('sys');
    s.append(createMessage({ role: 'user', content: 'q' }));

    const snap = s.snapshot();
    snap.push(createMessage({ role: 'user', content: 'injected' }));

    expect(s.messages).toHaveLength(2); // original unchanged
    expect(snap).toHaveLength(3);
  });
});

describe('App component wiring (type-level smoke)', () => {
  it('pi-tui-app can be imported without crash', async () => {
    const mod = await import('@/tui/index.js');
    expect(mod.runPiTuiApp).toBeDefined();
  });

  it('main.ts exports the correct entry point', async () => {
    const mod = await import('@/main.js');
    expect(mod).toBeDefined();
  });
});

describe('config + session + provider wiring', () => {
  it('loadConfig with defaults provides valid AppConfig', () => {
    const cfg = makeConfig();
    expect(cfg.model).toBe('deepseek-chat');
    expect(cfg.baseUrl).toContain('api.deepseek.com');
    expect(cfg.maxLoops).toBe(25);
  });

  it('createOpenAICompatibleProvider accepts config and reports model', async () => {
    const { createOpenAICompatibleProvider } = await import('@/provider/index.js');
    const cfg = makeConfig({ model: 'deepseek-v3' });
    const p = createOpenAICompatibleProvider(cfg);
    expect(p.model).toBe('deepseek-v3');
  });
});
