import { describe, it, expect } from 'vitest';
import { createMessage } from '@/session/index.js';
import {
  assistantHasDisplayContent,
  isMessageVisible,
  toolCallSummary,
} from '@/tui/message-display.js';

describe('assistantHasDisplayContent', () => {
  it('returns false for empty or whitespace-only content', () => {
    expect(assistantHasDisplayContent('')).toBe(false);
    expect(assistantHasDisplayContent('  \n  ')).toBe(false);
  });

  it('returns true when content has text', () => {
    expect(assistantHasDisplayContent('我会创建贪吃蛇游戏。')).toBe(true);
  });
});

describe('isMessageVisible with assistant toolCalls', () => {
  it('assistant message with toolCalls remains visible', () => {
    const m = createMessage({
      role: 'assistant',
      content: '让我先看看项目结构。',
      toolCalls: [{ id: 'c1', name: 'ls', arguments: { path: '.' } }],
    });
    expect(isMessageVisible(m)).toBe(true);
    expect(assistantHasDisplayContent(m.content)).toBe(true);
  });

  it('assistant message with only toolCalls has no display content', () => {
    const m = createMessage({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'ls', arguments: { path: 'src' } }],
    });
    expect(isMessageVisible(m)).toBe(true);
    expect(assistantHasDisplayContent(m.content)).toBe(false);
  });
});

describe('toolCallSummary', () => {
  it('formats ls path argument', () => {
    expect(toolCallSummary('ls', { path: 'src' })).toContain('path=');
  });
});
