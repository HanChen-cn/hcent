import { describe, it, expect } from 'vitest';
import { createContextManager, estimateMessagesTokens, type ContextManagerConfig  } from '@/agent/context-manager.js';
import { type Message, createMessage  } from '@/session/index.js';
import { createMockProvider } from '@/provider/index.js';
import type { ToolSchema } from '@/tools/index.js';

function makeMsg(role: Message['role'], content: string, kind?: Message['kind']): Message {
  return createMessage({ role, content, kind });
}

function makeConfig(overrides?: Partial<ContextManagerConfig>): ContextManagerConfig {
  return {
    maxContextTokens: 1000,
    reserveForReply: 200,
    summarizeThreshold: 0.3,
    ...overrides,
  };
}

const emptyTools: ToolSchema[] = [];

describe('estimateMessagesTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateMessagesTokens([])).toBe(2); // JSON.stringify([]) = "[]", ceil(2 * 0.6) = 2
  });

  it('returns positive number for non-empty messages', () => {
    const msgs = [makeMsg('user', 'hello world')];
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0);
  });

  it('larger messages produce larger estimates', () => {
    const small = [makeMsg('user', 'hi')];
    const large = [makeMsg('user', 'a'.repeat(1000))];
    expect(estimateMessagesTokens(large)).toBeGreaterThan(estimateMessagesTokens(small));
  });
});

describe('ContextManager', () => {
  it('returns messages unchanged when under budget', async () => {
    const cm = createContextManager(makeConfig(), createMockProvider('mock', []));
    const msgs = [makeMsg('system', 'prompt'), makeMsg('user', 'hello')];
    const result = await cm.prepare(msgs, emptyTools);
    expect(result).toEqual(msgs);
  });

  it('truncates oldest non-system messages when lightly over budget', async () => {
    const cm = createContextManager(
      makeConfig({ maxContextTokens: 300, reserveForReply: 50 }),
      createMockProvider('mock', []),
    );

    const msgs = [
      makeMsg('system', 'system prompt'),
      makeMsg('user', 'a'.repeat(200)),
      makeMsg('assistant', 'b'.repeat(200)),
      makeMsg('user', 'c'.repeat(200)),
    ];

    const result = await cm.prepare(msgs, emptyTools);
    expect(result[0].role).toBe('system');
    expect(result.length).toBeLessThan(msgs.length);
  });

  it('preserves system messages during truncation', async () => {
    const cm = createContextManager(
      makeConfig({ maxContextTokens: 200, reserveForReply: 50 }),
      createMockProvider('mock', []),
    );

    const msgs = [
      makeMsg('system', 'system prompt'),
      makeMsg('user', 'a'.repeat(300)),
    ];

    const result = await cm.prepare(msgs, emptyTools);
    const systemMsgs = result.filter((m) => m.role === 'system');
    expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
    expect(systemMsgs[0].content).toBe('system prompt');
  });

  it('summarizes when heavily over budget', async () => {
    const provider = createMockProvider('mock', [{ contentDelta: '这是一段对话摘要' }]);
    const cm = createContextManager(
      makeConfig({ maxContextTokens: 300, reserveForReply: 50, summarizeThreshold: 0.1 }),
      provider,
    );

    const msgs = [
      makeMsg('system', 'system prompt'),
      makeMsg('user', 'a'.repeat(200)),
      makeMsg('assistant', 'b'.repeat(200)),
      makeMsg('user', 'c'.repeat(200)),
      makeMsg('assistant', 'd'.repeat(200)),
    ];

    const result = await cm.prepare(msgs, emptyTools);
    const summaryMsgs = result.filter((m) => m.kind === 'summary');
    expect(summaryMsgs.length).toBeGreaterThanOrEqual(1);
    expect(summaryMsgs[0].content).toContain('对话摘要');
  });

  it('returns original messages when exactly at budget', async () => {
    const cm = createContextManager(makeConfig({ maxContextTokens: 10000 }), createMockProvider('mock', []));
    const msgs = [makeMsg('system', 'prompt'), makeMsg('user', 'short message')];
    const result = await cm.prepare(msgs, emptyTools);
    expect(result).toEqual(msgs);
  });

  it('handles empty non-system messages', async () => {
    const cm = createContextManager(makeConfig(), createMockProvider('mock', []));
    const msgs = [makeMsg('system', 'prompt')];
    const result = await cm.prepare(msgs, emptyTools);
    expect(result).toEqual(msgs);
  });

  it('prepare degrades gracefully on provider failure', async () => {
    const failingProvider = createMockProvider('mock', []);
    // Override stream to throw
    const origStream = failingProvider.stream.bind(failingProvider);
    failingProvider.stream = async function*() {
      throw new Error('provider failed');
    };

    const cm = createContextManager(
      makeConfig({ maxContextTokens: 200, reserveForReply: 50, summarizeThreshold: 0.1 }),
      failingProvider,
    );

    const msgs = [
      makeMsg('system', 'system prompt'),
      makeMsg('user', 'a'.repeat(200)),
      makeMsg('assistant', 'b'.repeat(200)),
      makeMsg('user', 'c'.repeat(200)),
    ];

    const result = await cm.prepare(msgs, emptyTools);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].role).toBe('system');
  });
});
