import { randomUUID } from 'node:crypto';

// ── §4.1 共享消息模型 ──

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type MessageKind = 'normal' | 'permission_reject' | 'error' | 'summary' | 'skill' | 'base';

export interface Message {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  kind?: MessageKind;
  ts: string;
}

// ── 工厂函数 ──

function now(): string {
  return new Date().toISOString();
}

export function createMessage(params: {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  kind?: MessageKind;
}): Message {
  return {
    role: params.role,
    content: params.content,
    toolCalls: params.toolCalls,
    toolCallId: params.toolCallId,
    kind: params.kind,
    ts: now(),
  };
}

export interface SkillMeta {
  name: string;
  filePath: string;
  description: string;
}

// ── §4.2 Session ──

export interface Session {
  readonly id: string;
  messages: Message[];
  readonly activeSkills: SkillMeta[];
  append(m: Message): void;
  clear(): void;
  snapshot(): Message[];
  addSkill(name: string, filePath: string, description: string, pointerContent: string): void;
  removeSkill(name: string): void;
  clearSkills(): void;
}

export function createSession(systemPrompt?: string): Session {
  const id = randomUUID();
  const messages: Message[] = [];
  const activeSkills: SkillMeta[] = [];

  if (systemPrompt) {
    messages.push(createMessage({ role: 'system', content: systemPrompt, kind: 'base' }));
  }

  return {
    id,
    messages,

    get activeSkills() {
      return activeSkills;
    },

    append(m: Message): void {
      messages.push(m);
    },

    clear(): void {
      const systemMessages = messages.filter((m) => m.role === 'system');
      messages.length = 0;
      messages.push(...systemMessages);
    },

    snapshot(): Message[] {
      return structuredClone(messages);
    },

    addSkill(name: string, filePath: string, description: string, pointerContent: string): void {
      if (activeSkills.some((s) => s.name === name)) return;
      activeSkills.push({ name, filePath, description });
      messages.push(createMessage({ role: 'system', content: pointerContent, kind: 'skill' }));
    },

    removeSkill(name: string): void {
      const idx = activeSkills.findIndex((s) => s.name === name);
      if (idx === -1) return;
      activeSkills.splice(idx, 1);
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'system' && m.kind === 'skill' && m.content.includes(`**${name}**`)) {
          messages.splice(i, 1);
          break;
        }
      }
    },

    clearSkills(): void {
      activeSkills.length = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'system' && messages[i].kind === 'skill') {
          messages.splice(i, 1);
        }
      }
    },
  };
}
