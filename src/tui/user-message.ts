import chalk from 'chalk';
import { Text, type Component } from '@earendil-works/pi-tui';

function formatUserDisplay(content: string): string {
  const lines = content.split('\n');
  return lines
    .map((line, i) => {
      const prefix = i === 0 ? chalk.green.bold('> ') : '   ';
      return prefix + line;
    })
    .join('\n');
}

/** 用户消息：绿色 > 前缀 + 灰底行背景 */
export class UserMessage implements Component {
  private readonly text: Text;

  constructor(content: string) {
    this.text = new Text(formatUserDisplay(content), 1, 0, (t) => chalk.bgGray(t));
  }

  invalidate(): void {
    this.text.invalidate();
  }

  render(width: number): string[] {
    return this.text.render(width);
  }
}

/** 流式 AI 回复前缀 */
export function formatAssistantStream(text: string): string {
  if (!text) return '● ';
  return `● ${text}`;
}

/** 静态 AI 回复前缀（非流式 rebuild 用） */
export function formatAssistantMessage(text: string): string {
  return text.startsWith('●') ? text : `● ${text}`;
}
