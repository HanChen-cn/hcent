import type { Message } from '../session/index.js';

/** 截断工具调用参数为人类可读摘要 */
export function toolCallSummary(name: string, args: Record<string, unknown>): string {
  if (name === 'Bash' || name === 'bash') {
    const cmd = typeof args.command === 'string' ? args.command : '';
    return cmd.length > 100 ? cmd.slice(0, 100) + '…' : cmd;
  }
  const keys = Object.keys(args).filter((k) => k !== 'description' && k !== 'content');
  const parts = keys.map((k) => {
    const v = typeof args[k] === 'string' && (args[k] as string).length > 60
      ? `"${(args[k] as string).slice(0, 60)}…"`
      : JSON.stringify(args[k]);
    return `${k}=${v}`;
  });
  if ('content' in args) {
    const content = String(args.content);
    parts.push(`content=(${content.length} chars)`);
  }
  const line = parts.join(', ');
  return line.length > 120 ? line.slice(0, 120) + '…' : line;
}

/** assistant 消息是否有可展示的文本内容 */
export function assistantHasDisplayContent(content: string): boolean {
  return content.trim().length > 0;
}

/** 是否应在消息列表中展示 */
export function isMessageVisible(m: Message): boolean {
  if (m.role === 'tool' && (!m.kind || m.kind === 'normal')) return false;
  if (m.kind === 'summary' || m.kind === 'base' || m.kind === 'skill') return false;
  return true;
}

const MAX_DISPLAY_ERROR = 200;

export function truncateDisplay(text: string): string {
  const cleaned = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  const firstLine = cleaned.split('\n')[0] ?? cleaned;
  if (firstLine.length <= MAX_DISPLAY_ERROR) return firstLine;
  return firstLine.slice(0, MAX_DISPLAY_ERROR) + '…';
}
