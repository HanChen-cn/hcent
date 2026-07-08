import type { Editor } from '@earendil-works/pi-tui';

/**
 * 在 Editor 内置历史上追加条目（去重相邻重复）。
 * Editor 已支持 ↑↓ 浏览历史，此 wrapper 统一提交侧调用。
 */
export function appendEditorHistory(editor: Editor, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  editor.addToHistory(trimmed);
}
