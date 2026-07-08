import chalk from 'chalk';
import {
  Editor,
  truncateToWidth,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from '@earendil-works/pi-tui';
import { extractSlashTokenAtCursor, shouldTriggerSlashMenu } from '../skill/skill-pointer.js';

/** pi-tui Editor 反色光标块 */
const CURSOR_BLOCK_RE = /\x1b\[7m[\s\S]*?\x1b\[0m/;

type EditorSlashHook = {
  tryTriggerAutocomplete(): void;
  isShowingAutocomplete(): boolean;
};

export class EditorWithPlaceholder extends Editor {
  private placeholderText = '';

  setPlaceholder(text: string): void {
    this.placeholderText = text;
  }

  handleInput(data: string): void {
    super.handleInput(data);
    this.maybeTriggerInlineSlashMenu();
  }

  private maybeTriggerInlineSlashMenu(): void {
    const hook = this as unknown as EditorSlashHook;
    if (hook.isShowingAutocomplete()) return;

    const { line, col } = this.getCursor();
    const textBeforeCursor = (this.getLines()[line] ?? '').slice(0, col);
    if (extractSlashTokenAtCursor(textBeforeCursor) !== null) {
      hook.tryTriggerAutocomplete();
    }
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (!this.placeholderText || this.getText().length > 0) {
      return lines;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(CURSOR_BLOCK_RE);
      if (!match || match.index === undefined) continue;

      const cursorEnd = match.index + match[0].length;
      const prefix = line.slice(0, cursorEnd);
      const suffixWidth = visibleWidth(line.slice(cursorEnd));
      if (suffixWidth <= 0) continue;

      const dimPh = chalk.dim(this.placeholderText);
      const truncated = truncateToWidth(dimPh, suffixWidth);
      const pad = ' '.repeat(Math.max(0, suffixWidth - visibleWidth(truncated)));
      lines[i] = prefix + truncated + pad;
      break;
    }

    return lines;
  }
}
