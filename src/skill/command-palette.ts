import type { SkillRegistry } from './index.js';

export interface PaletteEntry {
  type: 'command' | 'skill';
  name: string;
  description: string;
  keywords: string[];
}

export interface CommandPalette {
  entries(): PaletteEntry[];
  search(query: string): PaletteEntry[];
}

const BUILTIN_COMMANDS: PaletteEntry[] = [
  { type: 'command', name: 'help', description: '显示帮助信息', keywords: ['help', '帮助'] },
  { type: 'command', name: 'clear', description: '清除当前会话', keywords: ['clear', '清除'] },
  { type: 'command', name: 'model', description: '列出或切换模型', keywords: ['model', '模型'] },
  { type: 'command', name: 'status', description: '显示当前状态', keywords: ['status', '状态'] },
  { type: 'command', name: 'save', description: '保存当前会话', keywords: ['save', '保存'] },
  { type: 'command', name: 'load', description: '加载已保存会话', keywords: ['load', '加载'] },
  { type: 'command', name: 'sessions', description: '列出已保存会话', keywords: ['sessions', '会话'] },
  { type: 'command', name: 'exit', description: '退出程序', keywords: ['exit', '退出'] },
];

function subsequenceMatch(query: string, target: string): { matched: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let lastMatch = -1;
  let compactness = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (lastMatch >= 0) compactness += ti - lastMatch;
      lastMatch = ti;
      qi++;
    }
  }

  if (qi < q.length) return { matched: false, score: Infinity };
  return { matched: true, score: compactness };
}

export function createCommandPalette(skills: SkillRegistry): CommandPalette {
  return {
    entries(): PaletteEntry[] {
      const skillEntries: PaletteEntry[] = skills.list().map((s) => ({
        type: 'skill' as const,
        name: s.name,
        description: s.description,
        keywords: [s.name, s.description, ...s.triggers],
      }));
      return [...BUILTIN_COMMANDS, ...skillEntries];
    },

    search(query: string): PaletteEntry[] {
      if (!query) return this.entries();

      const all = this.entries();
      const results: { entry: PaletteEntry; score: number }[] = [];

      for (const entry of all) {
        const fields = [entry.name, entry.description, ...entry.keywords];
        let bestScore = Infinity;
        for (const field of fields) {
          const result = subsequenceMatch(query, field);
          if (result.matched && result.score < bestScore) {
            bestScore = result.score;
          }
        }
        if (bestScore < Infinity) {
          results.push({ entry, score: bestScore });
        }
      }

      return results.sort((a, b) => a.score - b.score).map((r) => r.entry);
    },
  };
}
