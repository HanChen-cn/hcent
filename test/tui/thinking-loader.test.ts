import { describe, expect, it } from 'vitest';
import {
  THINKING_PHRASES,
  formatShimmerMessage,
  pickThinkingPhrase,
} from '@/tui/thinking-loader.js';

describe('pickThinkingPhrase', () => {
  it('returns a phrase from the preset list', () => {
    expect(THINKING_PHRASES).toContain(pickThinkingPhrase());
  });

  it('avoids immediate repeat when exclude is given', () => {
    const exclude = THINKING_PHRASES[0]!;
    for (let i = 0; i < 20; i++) {
      expect(pickThinkingPhrase(exclude)).not.toBe(exclude);
    }
  });
});

describe('formatShimmerMessage', () => {
  it('returns dim text for empty input', () => {
    expect(formatShimmerMessage('', 0)).toBe('');
  });

  it('preserves visible text while formatting', () => {
    const text = '稍等，等我想想…';
    const formatted = formatShimmerMessage(text, 3);
    expect(formatted.replace(/\u001b\[[0-9;]*m/g, '')).toBe(text);
  });
});
