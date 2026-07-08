import type { AppConfig } from '../config/index.js';
import { type Session, createMessage } from '../session/index.js';
import type { ProviderManager } from '../provider/provider-manager.js';
import type { SessionStore } from '../session/session-store.js';
import type { AgentStatus } from '../agent/index.js';

export type CommandResult =
  | { type: 'clear' }
  | { type: 'exit' }
  | { type: 'help' }
  | { type: 'model'; name?: string }
  | { type: 'status' }
  | { type: 'save'; title?: string }
  | { type: 'load'; id?: string }
  | { type: 'sessions' };

const BUILTIN_PARSERS: Record<string, (parts: string[]) => CommandResult> = {
  '/help': () => ({ type: 'help' }),
  '/clear': () => ({ type: 'clear' }),
  '/exit': () => ({ type: 'exit' }),
  '/model': (parts) => ({ type: 'model', name: parts[1] }),
  '/status': () => ({ type: 'status' }),
  '/save': (parts) => ({ type: 'save', title: parts.slice(1).join(' ') || undefined }),
  '/load': (parts) => ({ type: 'load', id: parts[1] }),
  '/sessions': () => ({ type: 'sessions' }),
};

export function parseBuiltinCommand(input: string): CommandResult | null {
  if (!input.startsWith('/')) return null;
  const parts = input.trim().split(/\s+/);
  const parser = BUILTIN_PARSERS[parts[0]];
  return parser ? parser(parts) : null;
}

export interface BuiltinCommandContext {
  session: Session;
  store: SessionStore;
  providerManager: ProviderManager;
  config: AppConfig;
  modelName: string;
  status: AgentStatus;
  setModelName(name: string): void;
  onHelp(on: boolean): void;
  onClear(): void;
  onExit(): void;
  syncMessages(): void;
}

async function handleModelCommand(cmd: Extract<CommandResult, { type: 'model' }>, ctx: BuiltinCommandContext): Promise<void> {
  if (cmd.name) {
    try {
      ctx.providerManager.switch(cmd.name);
      ctx.setModelName(cmd.name);
      ctx.session.append(createMessage({ role: 'system', content: `已切换模型为 ${cmd.name}` }));
    } catch (err) {
      ctx.session.append(createMessage({
        role: 'system',
        content: `错误: ${err instanceof Error ? err.message : String(err)}`,
        kind: 'error',
      }));
    }
    return;
  }
  const models = ctx.providerManager.listModels();
  const lines = models.map((m) => {
    const active = m.name === ctx.providerManager.activeModelConfig.name ? ' (当前)' : '';
    return `  ${m.name}${active} — ${m.model} [ctx:${m.maxContextTokens}]`;
  });
  ctx.session.append(createMessage({ role: 'system', content: `可用模型:\n${lines.join('\n')}` }));
}

async function handleLoadCommand(cmd: Extract<CommandResult, { type: 'load' }>, ctx: BuiltinCommandContext): Promise<void> {
  if (!cmd.id) {
    const metas = await ctx.store.list();
    if (metas.length === 0) {
      ctx.session.append(createMessage({ role: 'system', content: '无已保存会话' }));
      return;
    }
    const lines = metas.map((m) => `  ${m.id.slice(0, 8)}  ${m.title}  [${m.messageCount}条]  ${m.updatedAt.slice(0, 16)}`);
    ctx.session.append(createMessage({ role: 'system', content: `已保存会话:\n${lines.join('\n')}` }));
    return;
  }

  try {
    let result = await ctx.store.load(cmd.id);
    if (!result) {
      const metas = await ctx.store.list();
      const match = metas.find((m) => m.id.startsWith(cmd.id!));
      if (match) result = await ctx.store.load(match.id);
    }
    if (result) {
      ctx.session.clear();
      for (const m of result.messages) {
        if (m.role !== 'system') ctx.session.append(m);
      }
      ctx.session.append(createMessage({ role: 'system', content: `已加载会话: ${result.meta.title}` }));
    } else {
      ctx.session.append(createMessage({ role: 'system', content: `会话 ${cmd.id} 不存在`, kind: 'error' }));
    }
  } catch (err) {
    ctx.session.append(createMessage({
      role: 'system',
      content: `加载失败: ${err instanceof Error ? err.message : String(err)}`,
      kind: 'error',
    }));
  }
}

async function handleSessionsCommand(ctx: BuiltinCommandContext): Promise<void> {
  const metas = await ctx.store.list();
  if (metas.length === 0) {
    ctx.session.append(createMessage({ role: 'system', content: '无已保存会话' }));
    return;
  }
  const lines = metas.map((m) => `  ${m.id.slice(0, 8)}  ${m.title}  [${m.messageCount}条]  ${m.lastModel}  ${m.updatedAt.slice(0, 16)}`);
  ctx.session.append(createMessage({ role: 'system', content: `已保存会话:\n${lines.join('\n')}` }));
}

async function handleSaveCommand(ctx: BuiltinCommandContext): Promise<void> {
  try {
    await ctx.store.save(ctx.session, ctx.modelName);
    ctx.session.append(createMessage({ role: 'system', content: '会话已保存' }));
  } catch (err) {
    ctx.session.append(createMessage({
      role: 'system',
      content: `保存失败: ${err instanceof Error ? err.message : String(err)}`,
      kind: 'error',
    }));
  }
  ctx.syncMessages();
}

async function handleStatusCommand(ctx: BuiltinCommandContext): Promise<void> {
  const info = [
    `模型: ${ctx.modelName}`,
    `baseUrl: ${ctx.providerManager.activeModelConfig.baseUrl}`,
    `消息数: ${ctx.session.messages.length}`,
    `最大轮次: ${ctx.config.maxLoops}`,
    `状态: ${ctx.status}`,
  ].join(' | ');
  ctx.session.append(createMessage({ role: 'system', content: info }));
  ctx.syncMessages();
}

export async function executeBuiltinCommand(cmd: CommandResult, ctx: BuiltinCommandContext): Promise<void> {
  if (cmd.type === 'help') return void ctx.onHelp(true);
  if (cmd.type === 'clear') return void ctx.onClear();
  if (cmd.type === 'exit') return void ctx.onExit();
  if (cmd.type === 'model') {
    await handleModelCommand(cmd, ctx);
    return void ctx.syncMessages();
  }
  if (cmd.type === 'status') return handleStatusCommand(ctx);
  if (cmd.type === 'save') return handleSaveCommand(ctx);
  if (cmd.type === 'load') {
    await handleLoadCommand(cmd, ctx);
    return void ctx.syncMessages();
  }
  await handleSessionsCommand(ctx);
  ctx.syncMessages();
}
