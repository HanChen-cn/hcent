import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { type Session, type Message, createMessage } from './index.js';

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastModel: string;
}

export interface SessionStore {
  save(session: Session, model: string): Promise<void>;
  load(id: string): Promise<{ messages: Message[]; meta: SessionMeta } | null>;
  list(): Promise<SessionMeta[]>;
  delete(id: string): Promise<boolean>;
}

function defaultDir(): string {
  return join(homedir(), '.config', 'hcent', 'sessions');
}

function extractTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return '（无标题）';
  const text = firstUser.content.slice(0, 50);
  return text.length < firstUser.content.length ? text + '…' : text;
}

function redactApiKey(messages: Message[], apiKeys: string[]): Message[] {
  if (apiKeys.length === 0) return messages;
  return messages.map((m) => {
    let content = m.content;
    for (const key of apiKeys) {
      if (key) content = content.replaceAll(key, '***');
    }
    return content === m.content ? m : { ...m, content };
  });
}

export function createSessionStore(dir?: string, apiKeys?: string[]): SessionStore {
  const storeDir = dir ?? defaultDir();

  function ensureDir() {
    try {
      mkdirSync(storeDir, { recursive: true });
    } catch {
      // already exists
    }
  }

  function filePath(id: string): string {
    return join(storeDir, `${id}.json`);
  }

  return {
    async save(session: Session, model: string): Promise<void> {
      try {
        ensureDir();
        const now = new Date().toISOString();
        const existing = readMeta(filePath(session.id));
        const meta: SessionMeta = {
          id: session.id,
          title: extractTitle(session.messages),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          messageCount: session.messages.length,
          lastModel: model,
        };
        const safeMessages = redactApiKey(session.messages, apiKeys ?? []);
        writeFileSync(filePath(session.id), JSON.stringify({ meta, messages: safeMessages }, null, 2), 'utf-8');
      } catch (err) {
        console.warn('保存会话失败:', err instanceof Error ? err.message : String(err));
      }
    },

    async load(id: string): Promise<{ messages: Message[]; meta: SessionMeta } | null> {
      try {
        const raw = readFileSync(filePath(id), 'utf-8');
        const data = JSON.parse(raw);
        if (!data.meta || !data.messages) return null;
        return { messages: data.messages as Message[], meta: data.meta as SessionMeta };
      } catch {
        return null;
      }
    },

    async list(): Promise<SessionMeta[]> {
      try {
        ensureDir();
        const files = readdirSync(storeDir).filter((f) => f.endsWith('.json'));
        const metas: SessionMeta[] = [];
        for (const file of files) {
          const meta = readMeta(join(storeDir, file));
          if (meta) metas.push(meta);
        }
        return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      } catch {
        return [];
      }
    },

    async delete(id: string): Promise<boolean> {
      try {
        unlinkSync(filePath(id));
        return true;
      } catch {
        return false;
      }
    },
  };
}

function readMeta(path: string): SessionMeta | null {
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    return data.meta ?? null;
  } catch {
    return null;
  }
}
