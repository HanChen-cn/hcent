import {
  CombinedAutocompleteProvider,
  fuzzyFilter,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  type SlashCommand,
} from '@earendil-works/pi-tui';
import { extractSlashTokenAtCursor } from '../skill/skill-pointer.js';

/**
 * 扩展 pi-tui CombinedAutocompleteProvider：支持行内 `/k-xxx`（不仅行首 `/`）。
 */
export class HcentAutocompleteProvider implements AutocompleteProvider {
  private readonly inner: CombinedAutocompleteProvider;

  constructor(commands: SlashCommand[], basePath: string) {
    this.inner = new CombinedAutocompleteProvider(commands, basePath);
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const textBeforeCursor = (lines[cursorLine] ?? '').slice(0, cursorCol);
    const slashToken = extractSlashTokenAtCursor(textBeforeCursor);

    if (slashToken !== null) {
      const slashItems = await this.getSlashCommandItems(slashToken, options);
      if (slashItems) return slashItems;
    }

    return this.inner.getSuggestions(lines, cursorLine, cursorCol, options);
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ) {
    if (prefix.startsWith('/') && !prefix.slice(1).includes(' ')) {
      const currentLine = lines[cursorLine] ?? '';
      const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
      const afterCursor = currentLine.slice(cursorCol);
      const newLine = `${beforePrefix}/${item.value} ${afterCursor}`;
      const newLines = [...lines];
      newLines[cursorLine] = newLine;
      return {
        lines: newLines,
        cursorLine,
        cursorCol: beforePrefix.length + item.value.length + 2,
      };
    }

    return this.inner.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    const textBeforeCursor = (lines[cursorLine] ?? '').slice(0, cursorCol);
    if (extractSlashTokenAtCursor(textBeforeCursor) !== null) {
      return false;
    }
    return this.inner.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
  }

  private async getSlashCommandItems(
    slashToken: string,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const query = slashToken.slice(1);
    const result = await this.inner.getSuggestions([slashToken], 0, slashToken.length, options);
    if (!result) return null;

    const commandItems = result.items.map((item) => {
      const name = String('name' in item ? item.name : item.value);
      return { name, label: item.label ?? name, description: item.description };
    });

    const filtered = fuzzyFilter(commandItems, query, (item) => item.name).map((item) => ({
      value: item.name,
      label: item.label,
      ...(item.description && { description: item.description }),
    }));

    if (filtered.length === 0) return null;

    return { items: filtered, prefix: slashToken };
  }
}
