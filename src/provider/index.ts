import OpenAI from 'openai';
import type { AppConfig } from '../config/index.js';
import type { Message, ToolCall } from '../session/index.js';
import type { ToolSchema } from '../tools/index.js';

// ── §4.3 Provider 接口 ──

export interface ProviderRequest {
  messages: Message[];
  tools: ToolSchema[];
  signal: AbortSignal;
}

export interface ProviderDelta {
  contentDelta?: string;
  toolCalls?: ToolCall[];
}

export interface Provider {
  readonly model: string;
  stream(req: ProviderRequest): AsyncIterable<ProviderDelta>;
}

// ── 消息 & 工具格式转换 ──

function buildMessagesForAPI(messages: Message[]) {
  return messages.map((m) => {
    const entry: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.toolCalls && m.toolCalls.length > 0) {
      entry.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }
    if (m.toolCallId) {
      entry.tool_call_id = m.toolCallId;
    }
    return entry;
  });
}

function buildToolsForAPI(tools: ToolSchema[]) {
  if (tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function buildToolCalls(accumulator: Map<number, { id?: string; name?: string; args: string }>): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const [, tc] of accumulator) {
    if (!tc.id || !tc.name) continue;
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(tc.args || '{}');
    } catch {
      parsedArgs = {};
    }
    calls.push({ id: tc.id, name: tc.name, arguments: parsedArgs });
  }
  return calls;
}

// ── OpenAI 兼容 Provider（OpenAI SDK 驱动，DeepSeek 等）──

function accumulateStreamToolCalls(
  tcAccumulator: Map<number, { id?: string; name?: string; args: string }>,
  toolCalls: NonNullable<OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta['tool_calls']>,
): void {
  for (const tc of toolCalls) {
    const acc = tcAccumulator.get(tc.index) ?? { args: '' };
    if (tc.id) acc.id = tc.id;
    if (tc.function?.name) acc.name = tc.function.name;
    if (tc.function?.arguments) acc.args += tc.function.arguments;
    tcAccumulator.set(tc.index, acc);
  }
}

async function* streamCompletionChunks(
  client: OpenAI,
  config: AppConfig,
  req: ProviderRequest,
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  const stream = await client.chat.completions.create(
    {
      model: config.model,
      messages: buildMessagesForAPI(req.messages) as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: buildToolsForAPI(req.tools) as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
      stream: true,
    },
    { signal: req.signal },
  );
  for await (const chunk of stream) {
    yield chunk;
  }
}

export function createOpenAICompatibleProvider(config: AppConfig): Provider {
  const client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey || 'sk-placeholder',
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  });

  return {
    model: config.model,

    async *stream(req: ProviderRequest) {
      const tcAccumulator = new Map<number, { id?: string; name?: string; args: string }>();

      for await (const chunk of streamCompletionChunks(client, config, req)) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { contentDelta: delta.content };
        }

        if (delta.tool_calls) {
          accumulateStreamToolCalls(tcAccumulator, delta.tool_calls);
        }
      }

      const toolCalls = buildToolCalls(tcAccumulator);
      if (toolCalls.length > 0) {
        yield { toolCalls };
      }
    },
  };
}

// ── MockProvider ──

export interface MockResponse {
  contentDelta?: string;
  toolCalls?: ToolCall[];
  delayMs?: number;
}

export function createMockProvider(
  model: string,
  responses: MockResponse[],
): Provider {
  let callIndex = -1;

  return {
    model,

    async *stream(_req: ProviderRequest) {
      callIndex++;
      const r = responses[callIndex];
      if (!r) return;

      if (r.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, r.delayMs));
      }

      if (r.contentDelta) {
        // 模拟流式逐字输出
        for (let i = 0; i < r.contentDelta.length; i++) {
          yield { contentDelta: r.contentDelta[i] };
        }
      }

      if (r.toolCalls) {
        yield { toolCalls: r.toolCalls };
      }
    },
  };
}
