import { describe, it, expect } from 'vitest';

describe('scaffold smoke', () => {
  it('vitest works', () => {
    expect(1 + 1).toBe(2);
  });

  it('can import pi-tui', async () => {
    const { TUI, ProcessTerminal } = await import('@earendil-works/pi-tui');
    expect(TUI).toBeDefined();
    expect(ProcessTerminal).toBeDefined();
  });
});
