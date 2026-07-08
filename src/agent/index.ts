import { type Message, type ToolCall, type Session, createMessage } from '../session/index.js';
import type { Provider } from '../provider/index.js';
import type { ToolRegistry, ToolResult } from '../tools/index.js';
import type { PermissionGate, PermissionDecision } from '../tools/permission.js';
import type { AppConfig } from '../config/index.js';
import type { ContextManager } from './context-manager.js';

// ── §4.7 Agent Loop 契约 ──

export type AgentStatus = 'idle' | 'thinking' | 'calling_tool' | 'awaiting_permission';

export interface AgentEvents {
  onStatus(s: AgentStatus): void;
  onAssistantDelta(text: string): void;
  /** assistant 消息已写入 session（含 toolCalls），可提交流式 UI */
  onAssistantComplete(): void;
  /** 即将调用 Provider 流式推理（含 prepare 完成后的等待首 token 阶段） */
  onStreamStart(): void;
  onToolCall(call: ToolCall): void;
  onToolResult(call: ToolCall, result: ToolResult, decision: PermissionDecision): void;
  onError(message: string): void;
}

// ── AgentDeps ──

export interface AgentDeps {
  provider: Provider;
  tools: ToolRegistry;
  permission: PermissionGate;
  session: Session;
  config: AppConfig;
  contextManager?: ContextManager;
}

// ── runAgentTurn ──

async function consumeProviderStream(
  deps: AgentDeps,
  events: AgentEvents,
): Promise<{ fullContent: string; lastToolCalls?: ToolCall[] } | { error: true }> {
  const controller = new AbortController();
  let fullContent = '';
  let lastToolCalls: ToolCall[] | undefined;

  try {
    const messages = deps.contextManager
      ? await deps.contextManager.prepare(deps.session.snapshot(), deps.tools.schemas())
      : deps.session.snapshot();

    events.onStreamStart();

    for await (const delta of deps.provider.stream({
      messages,
      tools: deps.tools.schemas(),
      signal: controller.signal,
    })) {
      if (delta.contentDelta) {
        fullContent += delta.contentDelta;
        events.onAssistantDelta(delta.contentDelta);
      }
      if (delta.toolCalls) {
        lastToolCalls = delta.toolCalls;
      }
    }
    return { fullContent, lastToolCalls };
  } catch (err) {
    const errMsg = createMessage({
      role: 'system',
      content: `错误: ${err instanceof Error ? err.message : String(err)}`,
      kind: 'error',
    });
    deps.session.append(errMsg);
    events.onError(errMsg.content);
    events.onStatus('idle');
    return { error: true };
  }
}

async function executeToolCall(
  tc: ToolCall,
  deps: AgentDeps,
  events: AgentEvents,
): Promise<void> {
  events.onToolCall(tc);

  const tool = deps.tools.get(tc.name);
  if (!tool) {
    deps.session.append(createMessage({
      role: 'tool',
      content: `错误: 未知工具 ${tc.name}`,
      toolCallId: tc.id,
      kind: 'error',
    }));
    return;
  }

  events.onStatus(tool.permission === 'auto' ? 'calling_tool' : 'awaiting_permission');
  const decision = await deps.permission.check(tool, tc.arguments);

  if (decision === 'deny') {
    deps.session.append(createMessage({
      role: 'tool',
      content: `用户拒绝执行 ${tc.name}`,
      toolCallId: tc.id,
      kind: 'permission_reject',
    }));
    events.onToolResult(tc, { ok: false, output: '', error: '用户拒绝执行' }, 'deny');
    return;
  }

  if (tool.permission !== 'auto') {
    events.onStatus('calling_tool');
  }
  const result = await tool.run(tc.arguments, {
    cwd: process.cwd(),
    signal: new AbortController().signal,
  });

  deps.session.append(createMessage({
    role: 'tool',
    content: result.ok ? result.output : `错误: ${result.error ?? '未知错误'}`,
    toolCallId: tc.id,
    kind: result.ok ? undefined : 'error',
  }));
  events.onToolResult(tc, result, 'allow');
}

export async function runAgentTurn(
  input: string,
  deps: AgentDeps,
  events: AgentEvents,
): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed) return;

  // 用户消息入历史
  const userMsg = createMessage({ role: 'user', content: trimmed });
  deps.session.append(userMsg);

  events.onStatus('thinking');

  let loopCount = 0;

  while (true) {
    loopCount++;

    const streamed = await consumeProviderStream(deps, events);
    if ('error' in streamed) return;

    const { fullContent, lastToolCalls } = streamed;

    deps.session.append(createMessage({
      role: 'assistant',
      content: fullContent,
      toolCalls: lastToolCalls && lastToolCalls.length > 0 ? lastToolCalls : undefined,
    }));
    events.onAssistantComplete();

    if (!lastToolCalls || lastToolCalls.length === 0) {
      events.onStatus('idle');
      return;
    }

    if (loopCount >= deps.config.maxLoops) {
      const limitMsg = createMessage({
        role: 'system',
        content: `达到最大轮次限制 (${deps.config.maxLoops})`,
        kind: 'error',
      });
      deps.session.append(limitMsg);
      events.onError(limitMsg.content);
      events.onStatus('idle');
      return;
    }

    for (const tc of lastToolCalls) {
      await executeToolCall(tc, deps, events);
    }

    events.onStatus('thinking');
  }
}
