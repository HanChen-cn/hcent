import chalk from 'chalk';
import { Container, Markdown, Text, type Component, type MarkdownTheme } from '@earendil-works/pi-tui';
import type { Message } from '../session/index.js';
import {
  assistantHasDisplayContent,
  isMessageVisible,
  toolCallSummary,
  truncateDisplay,
} from './message-display.js';
import { UserMessage, formatAssistantMessage } from './user-message.js';

function renderAssistantWithTools(
  m: Message,
  activeId: string | null,
  mdTheme: MarkdownTheme,
): Component {
  const container = new Container();
  if (assistantHasDisplayContent(m.content)) {
    container.addChild(new Markdown(formatAssistantMessage(m.content), 1, 0, mdTheme));
  }
  for (const tc of m.toolCalls ?? []) {
    const dot = chalk.yellow('⏺');
    const line = `${dot} ${chalk.magenta(tc.name)}(${toolCallSummary(tc.name, tc.arguments)})`;
    container.addChild(new Text(line, 1, 0));
  }
  return container;
}

export function renderMessageComponent(
  m: Message,
  activeId: string | null,
  mdTheme: MarkdownTheme,
): Component | null {
  if (!isMessageVisible(m)) return null;
  if (m.role === 'tool') {
    return new Text(chalk.red(`  ✗ ${truncateDisplay(m.content)}`), 1, 0);
  }
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return renderAssistantWithTools(m, activeId, mdTheme);
  }
  if (m.role === 'user') return new UserMessage(m.content);
  if (m.role === 'system') return new Text(chalk.gray(m.content), 1, 0);
  return new Markdown(formatAssistantMessage(m.content), 1, 0, mdTheme);
}
