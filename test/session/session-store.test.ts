import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionStore } from '@/session/session-store.js';
import { createSession, createMessage } from '@/session/index.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

function tmpStoreDir() {
  return join(tmpdir(), `tui-session-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('SessionStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpStoreDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('save creates a JSON file', async () => {
    const store = createSessionStore(dir);
    const session = createSession('system prompt');
    session.append(createMessage({ role: 'user', content: 'hello' }));

    await store.save(session, 'test-model');

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(session.id);
    expect(list[0].lastModel).toBe('test-model');
    expect(list[0].messageCount).toBe(2); // system + user
  });

  it('save extracts title from first user message', async () => {
    const store = createSessionStore(dir);
    const session = createSession('system prompt');
    session.append(createMessage({ role: 'user', content: '这是一个测试消息，很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长' }));

    await store.save(session, 'model');

    const list = await store.list();
    expect(list[0].title.length).toBeLessThanOrEqual(51); // 50 + '…'
    expect(list[0].title).toContain('这是一个测试消息');
  });

  it('load returns saved session', async () => {
    const store = createSessionStore(dir);
    const session = createSession('system prompt');
    session.append(createMessage({ role: 'user', content: 'hello' }));
    session.append(createMessage({ role: 'assistant', content: 'hi there' }));

    await store.save(session, 'model');

    const loaded = await store.load(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.meta.id).toBe(session.id);
    expect(loaded!.messages).toHaveLength(3); // system + user + assistant
    expect(loaded!.messages[1].content).toBe('hello');
  });

  it('load returns null for nonexistent id', async () => {
    const store = createSessionStore(dir);
    const loaded = await store.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('list returns sorted by updatedAt descending', async () => {
    const store = createSessionStore(dir);

    const s1 = createSession('prompt');
    s1.append(createMessage({ role: 'user', content: 'first' }));
    await store.save(s1, 'm1');

    // small delay to ensure different updatedAt
    await new Promise((r) => setTimeout(r, 10));

    const s2 = createSession('prompt');
    s2.append(createMessage({ role: 'user', content: 'second' }));
    await store.save(s2, 'm2');

    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[0].updatedAt >= list[1].updatedAt).toBe(true);
  });

  it('delete removes session', async () => {
    const store = createSessionStore(dir);
    const session = createSession('prompt');
    session.append(createMessage({ role: 'user', content: 'hello' }));

    await store.save(session, 'model');
    expect(await store.list()).toHaveLength(1);

    const deleted = await store.delete(session.id);
    expect(deleted).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });

  it('delete returns false for nonexistent id', async () => {
    const store = createSessionStore(dir);
    const deleted = await store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('redacts apiKey in saved messages', async () => {
    const store = createSessionStore(dir, ['sk-secret-key']);
    const session = createSession('system prompt');
    session.append(createMessage({ role: 'user', content: 'my key is sk-secret-key here' }));

    await store.save(session, 'model');

    const loaded = await store.load(session.id);
    expect(loaded!.messages[1].content).toBe('my key is *** here');
    expect(loaded!.messages[1].content).not.toContain('sk-secret-key');
  });

  it('overwrites existing session on re-save', async () => {
    const store = createSessionStore(dir);
    const session = createSession('prompt');
    session.append(createMessage({ role: 'user', content: 'v1' }));
    await store.save(session, 'model');

    session.append(createMessage({ role: 'assistant', content: 'reply' }));
    await store.save(session, 'model');

    const loaded = await store.load(session.id);
    expect(loaded!.messages).toHaveLength(3); // system + user + assistant
    expect(loaded!.meta.messageCount).toBe(3);
  });

  it('handles empty sessions directory', async () => {
    const store = createSessionStore(dir);
    const list = await store.list();
    expect(list).toEqual([]);
  });
});
