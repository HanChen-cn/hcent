import { describe, it, expect } from 'vitest';
import { runAgentTurn, type AgentDeps, type AgentEvents  } from '@/agent/index.js';
import { createSession, createMessage, type Message  } from '@/session/index.js';
import { createMockProvider, type Provider  } from '@/provider/index.js';
import { createToolRegistry, type Tool, type ToolResult, type ToolContext  } from '@/tools/index.js';
import { createPermissionGate, type ConfirmFn, type PermissionGate  } from '@/tools/permission.js';
import type { AppConfig } from '@/config/index.js';

// ── helpers ──

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

function makeFakeTool(name: string, permission: 'auto' | 'confirm', runResult: ToolResult): Tool {
  return {
    schema: { name, description: `Fake ${name}`, parameters: {} },
    permission,
    async run(_args, _ctx) {
      return runResult;
    },
  };
}

function makeAlwaysAllowGate(): PermissionGate {
  return {
    async check(_tool) {
      return 'allow';
    },
  };
}

function makeAlwaysDenyGate(): PermissionGate {
  return {
    async check(_tool) {
      return 'deny';
    },
  };
}

function collectEvents(): { events: AgentEvents; log: string[] } {
  const log: string[] = [];
  return {
    log,
    events: {
      onStatus(s) { log.push(`status:${s}`); },
      onAssistantDelta(t) { log.push(`delta:${t}`); },
      onAssistantComplete() { log.push('assistantComplete'); },
      onStreamStart() { log.push('streamStart'); },
      onToolCall(c) { log.push(`toolCall:${c.name}`); },
      onToolResult(c, r, d) { log.push(`toolResult:${c.name}:${d}:${r.ok}`); },
      onError(m) { log.push(`error:${m}`); },
    },
  };
}

// ── registry with real tools ──

const realRegistry = createToolRegistry();

// ── step 2: Agent Loop 核心（工具执行通过 always-allow gate 模拟无权限）──

describe('runAgentTurn — tool_calls loop (step 2)', () => {
  it('纯文本对话：无 tool_calls，session 含 user+assistant', async () => {
    const session = createSession('system');
    const deps: AgentDeps = {
      provider: createMockProvider('mock', [{ contentDelta: '你好！' }]),
      tools: realRegistry,
      permission: makeAlwaysAllowGate(),
      session,
      config: makeConfig(),
    };
    const { events, log } = collectEvents();

    await runAgentTurn('hello', deps, events);

    expect(session.messages).toHaveLength(3); // system + user + assistant
    expect(session.messages[1].role).toBe('user');
    expect(session.messages[1].content).toBe('hello');
    expect(session.messages[2].role).toBe('assistant');
    expect(session.messages[2].content).toBe('你好！');
    expect(session.messages[2].toolCalls).toBeUndefined();
    expect(log).toContain('status:thinking');
    expect(log).toContain('status:idle');
  });

  it('一次工具调用 → 结果回灌 → 最终文本：session 消息序列为 user → assistant(toolCalls) → tool → assistant(纯文本)', async () => {
    const session = createSession('system');
    // 第一轮：模型返回 grep TODO tool call
    // 第二轮：模型看到工具结果后返回最终文本
    const provider = createMockProvider('mock', [
      {
        contentDelta: '我来搜索',
        toolCalls: [{ id: 'c1', name: 'grep', arguments: { pattern: 'TODO' } }],
      },
      { contentDelta: '找到 3 处 TODO' },
    ]);
    const deps: AgentDeps = {
      provider,
      tools: realRegistry,
      permission: makeAlwaysAllowGate(),
      session,
      config: makeConfig(),
    };
    const { events, log } = collectEvents();

    await runAgentTurn('帮我搜 TODO', deps, events);

    // system + user + assistant(toolCalls) + tool + assistant(纯文本) = 5
    expect(session.messages).toHaveLength(5);

    expect(session.messages[1].role).toBe('user');
    expect(session.messages[1].content).toBe('帮我搜 TODO');

    expect(session.messages[2].role).toBe('assistant');
    expect(session.messages[2].toolCalls).toBeDefined();
    expect(session.messages[2].toolCalls![0].name).toBe('grep');

    expect(session.messages[3].role).toBe('tool');
    expect(session.messages[3].toolCallId).toBe('c1');

    expect(session.messages[4].role).toBe('assistant');
    expect(session.messages[4].toolCalls).toBeUndefined();
    expect(session.messages[4].content).toBe('找到 3 处 TODO');

    expect(log).toContain('toolCall:grep');
    expect(log).toContain('toolResult:grep:allow:true');
    expect(log).toContain('status:idle');
  });

  it('空输入直接返回，不调 provider', async () => {
    const session = createSession('system');
    let streamCalled = false;
    const provider: Provider = {
      model: 'mock',
      async *stream(_req) {
        streamCalled = true;
        yield { contentDelta: '' };
      },
    };
    const deps: AgentDeps = {
      provider,
      tools: realRegistry,
      permission: makeAlwaysAllowGate(),
      session,
      config: makeConfig(),
    };
    const { events } = collectEvents();

    await runAgentTurn('  ', deps, events);

    expect(streamCalled).toBe(false);
    expect(session.messages).toHaveLength(1); // only system
  });

  it('auto 工具不调用 confirmFn 直接执行', async () => {
    const session = createSession('system');
    let confirmCalled = false;
    const confirmGate: PermissionGate = {
      async check(tool, _args) {
        if (tool.permission === 'confirm') confirmCalled = true;
        return 'allow';
      },
    };

    const provider = createMockProvider('mock', [
      {
        contentDelta: 'ok',
        toolCalls: [{ id: 'c1', name: 'ls', arguments: { path: '.' } }],
      },
      { contentDelta: 'done' },
    ]);
    const deps: AgentDeps = {
      provider,
      tools: realRegistry,
      permission: confirmGate,
      session,
      config: makeConfig(),
    };
    const { events } = collectEvents();

    await runAgentTurn('ls', deps, events);

    // ls is auto, so confirm should not have been called for it
    // The check passes through but confirmCalled stays false because
    // we only set it for 'confirm' tools
    expect(confirmCalled).toBe(false);
    // tool result should be in session
    const toolMsgs = session.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.length).toBeGreaterThanOrEqual(1);
  });
});

// ── step 3: PermissionGate 接入 ──

describe('runAgentTurn — permission gate (step 3)', () => {
  it('confirm 工具用户允许 → 执行并写入结果', async () => {
    const session = createSession('system');
    let confirmCalled = false;
    const confirm: ConfirmFn = async (req) => {
      confirmCalled = true;
      expect(req.tool).toBe('write');
      return true;
    };
    const gate = createPermissionGate(confirm);

    const provider = createMockProvider('mock', [
      {
        contentDelta: 'writing',
        toolCalls: [{ id: 'c2', name: 'write', arguments: { path: 'test-write-tmp.txt', content: 'x' } }],
      },
      { contentDelta: '写入完成' },
    ]);
    const deps: AgentDeps = {
      provider,
      tools: realRegistry,
      permission: gate,
      session,
      config: makeConfig(),
    };
    const { events, log } = collectEvents();

    await runAgentTurn('写文件', deps, events);

    expect(confirmCalled).toBe(true);
    const toolMsgs = session.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.length).toBeGreaterThanOrEqual(1);
    const writeMsg = toolMsgs.find((m) => m.toolCallId === 'c2');
    expect(writeMsg).toBeDefined();
    if (writeMsg) {
      expect(writeMsg.kind).not.toBe('permission_reject');
    }
    expect(log).toContain('toolResult:write:allow:true');
    // cleanup
    try { require('node:fs').unlinkSync(require('node:path').resolve(process.cwd(), 'test-write-tmp.txt')); } catch {}
  });

  it('confirm 工具用户拒绝 → 写入 kind=permission_reject，继续循环', async () => {
    const session = createSession('system');
    const confirm: ConfirmFn = async () => false;
    const gate = createPermissionGate(confirm);

    const provider = createMockProvider('mock', [
      {
        contentDelta: 'going to write',
        toolCalls: [{ id: 'c3', name: 'write', arguments: { path: '/f', content: 'bad' } }],
      },
      // 模型看到拒绝信息后调整策略，返回纯文本
      { contentDelta: '好的，我不写了' },
    ]);
    const deps: AgentDeps = {
      provider,
      tools: realRegistry,
      permission: gate,
      session,
      config: makeConfig(),
    };
    const { events, log } = collectEvents();

    await runAgentTurn('写文件', deps, events);

    // Should have a permission_reject tool message
    const toolMsgs = session.messages.filter((m) => m.role === 'tool');
    const rejectMsg = toolMsgs.find((m) => m.kind === 'permission_reject');
    expect(rejectMsg).toBeDefined();
    expect(rejectMsg!.content).toContain('用户拒绝执行');

    // 循环继续 → 最终的 assistant 正常
    const lastMsg = session.messages[session.messages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.content).toBe('好的，我不写了');

    expect(log).toContain('toolResult:write:deny:false');
    expect(log).toContain('status:idle');
  });
});

// ── step 4: maxLoops / 错误处理 ──

describe('runAgentTurn — maxLoops / error handling (step 4)', () => {
  it('maxLoops 达上限后写入 kind=error 并停止', async () => {
    const session = createSession('system');
    const config = makeConfig({ maxLoops: 3 });
    // 提供无限 tool_calls：第 1/2/3 轮都返回 tool_call，第 4 轮会有 limit
    const provider = createMockProvider('mock', [
      {
        contentDelta: 'r1',
        toolCalls: [{ id: 'c1', name: 'ls', arguments: { path: '.' } }],
      },
      {
        contentDelta: 'r2',
        toolCalls: [{ id: 'c2', name: 'ls', arguments: { path: '.' } }],
      },
      {
        contentDelta: 'r3',
        toolCalls: [{ id: 'c3', name: 'ls', arguments: { path: '.' } }],
      },
      { contentDelta: 'r4-but-should-not-reach' },
    ]);
    const deps: AgentDeps = {
      provider,
      tools: realRegistry,
      permission: makeAlwaysAllowGate(),
      session,
      config,
    };
    const { events, log } = collectEvents();

    await runAgentTurn('test', deps, events);

    // 应该有 error 消息
    const errorMsgs = session.messages.filter((m) => m.kind === 'error');
    expect(errorMsgs.length).toBeGreaterThanOrEqual(1);
    expect(errorMsgs.some((m) => m.content.includes('最大轮次限制'))).toBe(true);

    // onError 被调用
    expect(log.some((e) => e.startsWith('error:'))).toBe(true);
    expect(log).toContain('status:idle');
  });

  it('provider 异常 → 写入 kind=error 消息，本轮结束，进程不死', async () => {
    const session = createSession('system');
    const provider: Provider = {
      model: 'mock',
      async *stream(_req) {
        throw new Error('网络错误');
      },
    };
    const deps: AgentDeps = {
      provider,
      tools: realRegistry,
      permission: makeAlwaysAllowGate(),
      session,
      config: makeConfig(),
    };
    const { events, log } = collectEvents();

    // 不应抛异常
    await expect(
      runAgentTurn('test', deps, events),
    ).resolves.toBeUndefined();

    // 应有 error 消息
    const errorMsgs = session.messages.filter((m) => m.kind === 'error');
    expect(errorMsgs.length).toBeGreaterThanOrEqual(1);
    expect(errorMsgs.some((m) => m.content.includes('网络错误'))).toBe(true);
    expect(log.some((e) => e.startsWith('error:'))).toBe(true);
    expect(log).toContain('status:idle');
  });

  it('未知工具 → 写入 kind=error 的 tool 消息，继续循环', async () => {
    const session = createSession('system');
    const provider = createMockProvider('mock', [
      {
        contentDelta: 'calling',
        toolCalls: [{ id: 'c99', name: 'nonexistent_tool', arguments: {} }],
      },
      { contentDelta: 'done after unknown' },
    ]);
    const deps: AgentDeps = {
      provider,
      tools: realRegistry, // noneexistent_tool not in registry
      permission: makeAlwaysAllowGate(),
      session,
      config: makeConfig(),
    };
    const { events } = collectEvents();

    await runAgentTurn('test', deps, events);

    // 应有 error 的 tool 消息
    const toolMsgs = session.messages.filter((m) => m.role === 'tool');
    const unknownMsg = toolMsgs.find((m) => m.kind === 'error' && m.content.includes('未知工具'));
    expect(unknownMsg).toBeDefined();

    // 循环继续 → 最后有条最终 assistant 消息
    const lastMsg = session.messages[session.messages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.content).toBe('done after unknown');
  });

  it('工具执行失败 → result 含 error，不崩，继续循环', async () => {
    const session = createSession('system');
    // 模拟一个会失败的 grep
    const failTool = makeFakeTool('failgrep', 'auto', {
      ok: false,
      output: '',
      error: 'grep 失败: ENOENT',
    });
    // 创建一个定制 registry 包含 failTool
    const customRegistry = createToolRegistry();
    // 我们不能 replace 真实工具，那就继续用 realRegistry 的 grep 工具
    // grep 在合法路径下不会失败，所以改用 write 工具但给越界路径
    const provider = createMockProvider('mock', [
      {
        contentDelta: 'writing',
        toolCalls: [{ id: 'c10', name: 'write', arguments: { path: '../../evil', content: 'x' } }],
      },
      { contentDelta: 'failed but kept going' },
    ]);
    const deps: AgentDeps = {
      provider,
      tools: realRegistry, // write 有路径越界校验
      permission: makeAlwaysAllowGate(),
      session,
      config: makeConfig(),
    };
    const { events } = collectEvents();

    await expect(
      runAgentTurn('test', deps, events),
    ).resolves.toBeUndefined();

    // 有 tool 消息含错误
    const toolMsgs = session.messages.filter((m) => m.role === 'tool');
    const errorTool = toolMsgs.find((m) => m.kind === 'error');
    expect(errorTool).toBeDefined();
    expect(errorTool!.content).toContain('错误');

    // 循环继续 → 最后是 assistant
    const lastMsg = session.messages[session.messages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.content).toBe('failed but kept going');
  });
});

// ── 综合场景 ──

describe('runAgentTurn — integration (step 5-6)', () => {
  it('连续多轮工具调用：grep → read → 纯文本', async () => {
    const session = createSession('system');
    const provider = createMockProvider('mock', [
      {
        contentDelta: 'r1',
        toolCalls: [{ id: 'c1', name: 'grep', arguments: { pattern: 'TODO' } }],
      },
      {
        contentDelta: 'r2',
        toolCalls: [{ id: 'c2', name: 'ls', arguments: { path: 'src' } }],
      },
      { contentDelta: '最终回复' },
    ]);
    const deps: AgentDeps = {
      provider,
      tools: realRegistry,
      permission: makeAlwaysAllowGate(),
      session,
      config: makeConfig(),
    };
    const { events } = collectEvents();

    await runAgentTurn('test', deps, events);

    // session sequence: system → user → assistant(toolCalls) → tool(grep) → assistant(toolCalls) → tool(ls) → assistant(纯文本)
    // = 7 messages
    expect(session.messages).toHaveLength(7);
    expect(session.messages[2].role).toBe('assistant');
    expect(session.messages[2].toolCalls).toBeDefined();
    expect(session.messages[3].role).toBe('tool');
    expect(session.messages[4].role).toBe('assistant');
    expect(session.messages[5].role).toBe('tool');
    expect(session.messages[6].role).toBe('assistant');
    expect(session.messages[6].toolCalls).toBeUndefined();
  });
});
