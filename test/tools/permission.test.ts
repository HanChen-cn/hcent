import { describe, it, expect, vi } from 'vitest';
import { createPermissionGate, type ConfirmFn  } from '@/tools/permission.js';
import { createToolRegistry } from '@/tools/index.js';

function noopCtx() {
  return { cwd: '/tmp', signal: new AbortController().signal };
}

describe('PermissionGate', () => {
  it('auto-approves read-only tools', async () => {
    const confirm = vi.fn<ConfirmFn>();
    const gate = createPermissionGate(confirm);
    const reg = createToolRegistry();

    const result = await gate.check(reg.get('ls')!, {});
    expect(result).toBe('allow');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('calls confirm for write tools', async () => {
    const confirm = vi.fn<ConfirmFn>().mockResolvedValue(true);
    const gate = createPermissionGate(confirm);
    const reg = createToolRegistry();

    const result = await gate.check(reg.get('write')!, { path: 'f', content: 'x' });
    expect(result).toBe('allow');
    expect(confirm).toHaveBeenCalledWith({ tool: 'write', args: { path: 'f', content: 'x' } });
  });

  it('denies when confirm returns false', async () => {
    const confirm = vi.fn<ConfirmFn>().mockResolvedValue(false);
    const gate = createPermissionGate(confirm);
    const reg = createToolRegistry();

    const result = await gate.check(reg.get('bash')!, { command: 'rm -rf /' });
    expect(result).toBe('deny');
  });

  it('auto-approves all auto tools without calling confirm', async () => {
    const confirm = vi.fn<ConfirmFn>();
    const gate = createPermissionGate(confirm);
    const reg = createToolRegistry();

    const autoTools = ['ls', 'read', 'glob', 'grep'];
    for (const name of autoTools) {
      const result = await gate.check(reg.get(name)!, {});
      expect(result, `${name} should be auto-allowed`).toBe('allow');
    }
    expect(confirm).not.toHaveBeenCalled();
  });

  it('calls confirm for all confirm-level tools', async () => {
    const confirm = vi.fn<ConfirmFn>().mockResolvedValue(true);
    const gate = createPermissionGate(confirm);
    const reg = createToolRegistry();

    const confirmTools = ['write', 'edit', 'bash'];
    for (const name of confirmTools) {
      const result = await gate.check(reg.get(name)!, {});
      expect(result).toBe('allow');
      expect(confirm).toHaveBeenCalledWith({ tool: name, args: {} });
    }
    expect(confirm).toHaveBeenCalledTimes(3);
  });
});
