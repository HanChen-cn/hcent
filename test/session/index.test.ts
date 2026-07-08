import { describe, it, expect } from 'vitest';
import {
  createSession,
  createMessage,
  type Message,
  type Session,
} from '@/session/index.js';

function addTestSkill(s: Session, name: string, description: string, filePath = `/skills/${name}/SKILL.md`) {
  s.addSkill(name, filePath, description, `用户引用了 skill **${name}**。\nSkill 文件路径: ${filePath}`);
}

describe('createMessage', () => {
  it('creates a message with role and content', () => {
    const m = createMessage({ role: 'user', content: 'hello' });
    expect(m.role).toBe('user');
    expect(m.content).toBe('hello');
    expect(m.kind).toBeUndefined();
    expect(m.ts).toBeTruthy();
    expect(Date.parse(m.ts)).not.toBeNaN();
  });

  it('creates a tool message with toolCallId', () => {
    const m = createMessage({
      role: 'tool',
      content: 'read result',
      toolCallId: 'call_1',
    });
    expect(m.role).toBe('tool');
    expect(m.toolCallId).toBe('call_1');
  });

  it('creates an assistant message with toolCalls', () => {
    const calls = [{ id: 'c1', name: 'read', arguments: { path: '/x' } }];
    const m = createMessage({ role: 'assistant', content: '', toolCalls: calls });
    expect(m.toolCalls).toEqual(calls);
  });

  it('creates a permission_reject message', () => {
    const m = createMessage({
      role: 'tool',
      content: '用户拒绝执行 write',
      toolCallId: 'call_r',
      kind: 'permission_reject',
    });
    expect(m.kind).toBe('permission_reject');
  });

  it('each message gets a timestamp', () => {
    const a = createMessage({ role: 'user', content: 'a' });
    const b = createMessage({ role: 'user', content: 'b' });
    expect(Date.parse(a.ts)).not.toBeNaN();
    expect(Date.parse(b.ts)).not.toBeNaN();
  });
});

describe('Session', () => {
  it('creates a session with UUID id', () => {
    const s = createSession();
    expect(s.id).toBeTruthy();
    expect(s.messages).toEqual([]);
  });

  it('creates a session with system prompt', () => {
    const s = createSession('You are a helpful assistant.');
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('system');
    expect(s.messages[0].content).toBe('You are a helpful assistant.');
  });

  it('append adds messages in order', () => {
    const s = createSession();
    s.append(createMessage({ role: 'user', content: 'hi' }));
    s.append(createMessage({ role: 'assistant', content: 'hello' }));
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0].role).toBe('user');
    expect(s.messages[1].role).toBe('assistant');
  });

  it('clear removes non-system messages', () => {
    const s = createSession('system prompt');
    s.append(createMessage({ role: 'user', content: 'q1' }));
    s.append(createMessage({ role: 'assistant', content: 'a1' }));
    s.append(createMessage({ role: 'user', content: 'q2' }));
    s.clear();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('system');
    expect(s.messages[0].content).toBe('system prompt');
  });

  it('clear on empty session is safe', () => {
    const s = createSession();
    s.clear();
    expect(s.messages).toEqual([]);
  });

  it('snapshot returns deep copy', () => {
    const s = createSession();
    s.append(createMessage({ role: 'user', content: 'q' }));
    const snap = s.snapshot();

    // mutate original
    s.messages[0].content = 'modified';

    expect(snap[0].content).toBe('q');
    expect(s.messages[0].content).toBe('modified');
  });

  it('snapshot mutations do not corrupt session', () => {
    const s = createSession();
    s.append(createMessage({ role: 'user', content: 'q' }));
    const snap = s.snapshot();
    snap[0].content = 'hacked';
    snap.push(createMessage({ role: 'assistant', content: 'injected' }));

    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].content).toBe('q');
  });

  it('full multi-turn conversation flow', () => {
    const s = createSession('sys');

    // turn 1
    s.append(createMessage({ role: 'user', content: 'read file' }));
    s.append(
      createMessage({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: { path: '/f' } }],
      })
    );
    s.append(createMessage({ role: 'tool', content: 'file content', toolCallId: 'c1' }));
    s.append(createMessage({ role: 'assistant', content: 'file says: file content' }));

    // turn 2 — permission reject
    s.append(createMessage({ role: 'user', content: 'write file' }));
    s.append(
      createMessage({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c2', name: 'write', arguments: { path: '/f', content: 'x' } }],
      })
    );
    s.append(
      createMessage({
        role: 'tool',
        content: '用户拒绝执行 write',
        toolCallId: 'c2',
        kind: 'permission_reject',
      })
    );

    expect(s.messages).toHaveLength(8);
    expect(s.snapshot()).toHaveLength(8);

    s.clear();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('system');
  });

  it('supports multiple active skills', () => {
    const s = createSession();
    expect(s.activeSkills).toEqual([]);

    addTestSkill(s, 'review', 'review 模式');
    addTestSkill(s, 'debug', 'debug 模式');
    expect(s.activeSkills).toHaveLength(2);
    expect(s.activeSkills[0].name).toBe('review');
    expect(s.activeSkills[1].name).toBe('debug');
    expect(s.activeSkills[0].filePath).toContain('review');

    // 同名不重复添加
    addTestSkill(s, 'review', 'review 模式');
    expect(s.activeSkills).toHaveLength(2);

    // messages 中有两条 skill system message
    const skillMsgs = s.messages.filter((m) => m.kind === 'skill');
    expect(skillMsgs).toHaveLength(2);

    s.removeSkill('review');
    expect(s.activeSkills).toHaveLength(1);
    expect(s.activeSkills[0].name).toBe('debug');

    s.clearSkills();
    expect(s.activeSkills).toHaveLength(0);
    expect(s.messages.filter((m) => m.kind === 'skill')).toHaveLength(0);
  });

  it('clear preserves skill messages', () => {
    const s = createSession('sys');
    addTestSkill(s, 'k-feat', 'feat skill');
    s.append(createMessage({ role: 'user', content: 'q' }));
    s.append(createMessage({ role: 'assistant', content: 'a' }));
    s.clear();
    // system + skill messages preserved
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0].role).toBe('system');
    expect(s.messages[1].kind).toBe('skill');
    expect(s.activeSkills).toHaveLength(1);
  });

  it('snapshot isolates toolCalls array', () => {
    const calls = [{ id: 'c1', name: 'read', arguments: { path: '/f' } }];
    const s = createSession();
    s.append(createMessage({ role: 'assistant', content: '', toolCalls: calls }));

    const snap = s.snapshot();
    snap[0].toolCalls![0].name = 'hacked';

    expect(s.messages[0].toolCalls![0].name).toBe('read');
  });
});
