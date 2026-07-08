import { visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui';

/**
 * 右对齐文本。不经过 pi-tui Text（Text 会把每行 pad 到满宽，导致无法再左 pad 右对齐）。
 */
export class RightAlignedText implements Component {
  private text = '';
  private paddingY: number;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(text = '', paddingY = 0) {
    this.text = text;
    this.paddingY = paddingY;
  }

  setText(text: string): void {
    this.text = text;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    for (let i = 0; i < this.paddingY; i++) {
      lines.push('');
    }

    const normalized = this.text.replace(/\t/g, '   ');
    if (normalized.trim()) {
      for (const raw of wrapTextWithAnsi(normalized, width)) {
        const vis = visibleWidth(raw);
        lines.push(' '.repeat(Math.max(0, width - vis)) + raw);
      }
    }

    for (let i = 0; i < this.paddingY; i++) {
      lines.push('');
    }

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}
