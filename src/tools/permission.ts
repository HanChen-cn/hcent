import type { Tool } from './index.js';

// ── §4.5 权限网关接口 ──

export type PermissionDecision = 'allow' | 'deny';

/** UI 提供的确认回调，由 M8 在装配时注入 */
export type ConfirmFn = (req: { tool: string; args: Record<string, unknown> }) => Promise<boolean>;

export interface PermissionGate {
  check(tool: Tool, args: Record<string, unknown>): Promise<PermissionDecision>;
}

export function createPermissionGate(confirm: ConfirmFn): PermissionGate {
  return {
    async check(tool, args) {
      if (tool.permission === 'auto') return 'allow';
      const ok = await confirm({ tool: tool.schema.name, args });
      return ok ? 'allow' : 'deny';
    },
  };
}
