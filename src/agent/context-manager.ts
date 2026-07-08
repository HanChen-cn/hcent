import type { Message } from '../session/index.js';
import type { Provider, ProviderRequest } from '../provider/index.js';
import type { ToolSchema } from '../tools/index.js';

export interface ContextManagerConfig {
  maxContextTokens: number;
  reserveForReply: number;
  summarizeThreshold: number;
}

export interface ContextManager {
  prepare(messages: Message[], toolSchemas: ToolSchema[]): Promise<Message[]>;
  estimateTokens(messages: Message[]): number;
}

export function estimateMessagesTokens(messages: Message[]): number {
  return Math.ceil(JSON.stringify(messages).length * 0.6);
}

function estimateToolSchemasTokens(toolSchemas: ToolSchema[]): number {
  return Math.ceil(JSON.stringify(toolSchemas).length * 0.6);
}

export function createContextManager(
  config: ContextManagerConfig,
  provider: Provider,
): ContextManager {
  let cachedSummary: string | null = null;
  let cachedSummaryKey: string | null = null;

  return {
    estimateTokens(messages: Message[]): number {
      return estimateMessagesTokens(messages);
    },

    async prepare(messages: Message[], toolSchemas: ToolSchema[]): Promise<Message[]> {
      const systemMessages = messages.filter((m) => m.role === 'system');
      const nonSystemMessages = messages.filter((m) => m.role !== 'system');

      const overhead =
        estimateMessagesTokens(systemMessages) +
        estimateToolSchemasTokens(toolSchemas) +
        config.reserveForReply;

      const budget = config.maxContextTokens - overhead;
      if (budget <= 0) return messages;

      const historyTokens = estimateMessagesTokens(nonSystemMessages);
      if (historyTokens <= budget) return messages;

      const discardTokens = historyTokens - budget;
      const discardRatio = discardTokens / historyTokens;

      if (discardRatio <= config.summarizeThreshold) {
        return truncateMessages(systemMessages, nonSystemMessages, budget);
      }

      return await summarizeAndTruncate(
        systemMessages,
        nonSystemMessages,
        budget,
        provider,
        config,
        (key) => {
          if (cachedSummaryKey === key) return cachedSummary;
          return null;
        },
        (key, summary) => {
          cachedSummaryKey = key;
          cachedSummary = summary;
        },
      );
    },
  };
}

function truncateMessages(
  systemMessages: Message[],
  nonSystemMessages: Message[],
  budget: number,
): Message[] {
  const result: Message[] = [...nonSystemMessages];
  while (result.length > 0 && estimateMessagesTokens(result) > budget) {
    result.shift();
  }
  return [...systemMessages, ...result];
}

async function summarizeAndTruncate(
  systemMessages: Message[],
  nonSystemMessages: Message[],
  budget: number,
  provider: Provider,
  config: ContextManagerConfig,
  getCachedSummary: (key: string) => string | null,
  setCachedSummary: (key: string, summary: string) => void,
): Promise<Message[]> {
  const discardCount = Math.ceil(nonSystemMessages.length * 0.5);
  const toSummarize = nonSystemMessages.slice(0, discardCount);
  const toKeep = nonSystemMessages.slice(discardCount);

  const cacheKey = JSON.stringify(toSummarize.map((m) => m.ts));
  const cached = getCachedSummary(cacheKey);

  let summaryText: string;
  if (cached) {
    summaryText = cached;
  } else {
    try {
      summaryText = await generateSummary(toSummarize, provider);
      setCachedSummary(cacheKey, summaryText);
    } catch {
      return truncateMessages(systemMessages, nonSystemMessages, budget);
    }
  }

  const summaryMessage: Message = {
    role: 'system',
    content: `[对话摘要] ${summaryText}`,
    kind: 'summary',
    ts: new Date().toISOString(),
  };

  const systemAndSummaryTokens = estimateMessagesTokens([...systemMessages, summaryMessage]);
  const remainingBudget = budget - systemAndSummaryTokens + estimateMessagesTokens(systemMessages);

  const kept: Message[] = [...toKeep];
  while (kept.length > 0 && estimateMessagesTokens(kept) > remainingBudget) {
    kept.shift();
  }

  return [...systemMessages, summaryMessage, ...kept];
}

async function generateSummary(messages: Message[], provider: Provider): Promise<string> {
  const conversation = messages
    .map((m) => {
      const prefix = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : m.role;
      return `${prefix}: ${m.content.slice(0, 200)}`;
    })
    .join('\n');

  const prompt: Message = {
    role: 'user',
    content: `请用 200 字以内概括以下对话要点：\n\n${conversation}`,
    ts: new Date().toISOString(),
  };

  const req: ProviderRequest = {
    messages: [
      { role: 'system', content: '你是一个对话摘要助手。请简洁概括对话要点。', ts: new Date().toISOString() },
      prompt,
    ],
    tools: [],
    signal: AbortSignal.timeout(15000),
  };

  let summary = '';
  for await (const delta of provider.stream(req)) {
    if (delta.contentDelta) summary += delta.contentDelta;
  }
  return summary || '（摘要生成失败）';
}
