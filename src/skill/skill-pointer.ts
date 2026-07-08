import type { Skill } from './index.js';

/** 从用户输入中提取 `/skill-name` 引用（支持一行多个，含句读符后直接跟 /） */
export const SKILL_REF_RE = /(?:^|[\s。，！？；：])\/([a-zA-Z0-9_-]+)/g;

export interface ExtractedSkillRefs {
  skills: Skill[];
  unknown: string[];
}

export function buildSkillPointerContent(skill: Pick<Skill, 'name' | 'description' | 'filePath'>): string {
  return [
    `用户引用了 skill **${skill.name}**。`,
    `Skill 文件路径: ${skill.filePath}`,
    `说明: ${skill.description}`,
    '',
    '请按需读取上述 SKILL.md（渐进式披露），仅在任务相关时加载内容，不要预加载全文。',
  ].join('\n');
}

export function extractSkillReferences(text: string, getSkill: (name: string) => Skill | undefined): ExtractedSkillRefs {
  const skills: Skill[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(SKILL_REF_RE)) {
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);

    const skill = getSkill(name);
    if (skill) {
      skills.push(skill);
    } else {
      unknown.push(name);
    }
  }

  return { skills, unknown };
}

/** 去掉 skill 引用后是否还有实质用户内容 */
export function hasUserContentBeyondSkills(text: string): boolean {
  return text.replace(SKILL_REF_RE, '').trim().length > 0;
}

/**
 * 光标处正在输入的斜杠 token（如 `/k-feat` 或行中 `。/k`）。
 * 取最后一个 `/` 到光标之间的片段，排除 `./`、`../` 等路径前缀。
 */
export function extractSlashTokenAtCursor(textBeforeCursor: string): string | null {
  const slashIdx = textBeforeCursor.lastIndexOf('/');
  if (slashIdx === -1) return null;

  const token = textBeforeCursor.slice(slashIdx);
  if (!token.startsWith('/')) return null;
  if (/\s/.test(token.slice(1))) return null;
  if (/^\.\//.test(token) || /^\.\.\//.test(token) || /^~\//.test(token)) return null;

  const charBefore = slashIdx > 0 ? textBeforeCursor[slashIdx - 1] : '';
  if (/[a-zA-Z0-9_]/.test(charBefore)) return null;

  return token;
}

/** 刚输入 `/` 时是否应打开斜杠命令/ skill 补全 */
export function shouldTriggerSlashMenu(textBeforeCursor: string): boolean {
  if (!textBeforeCursor.endsWith('/')) return false;
  if (textBeforeCursor === '/') return true;

  const prev = textBeforeCursor[textBeforeCursor.length - 2];
  if (prev === ' ' || prev === '\t') return true;
  // 中文或句读符后直接跟 skill 引用（如 `你好。/k`）
  if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef。，！？；：]/.test(prev ?? '')) return true;
  // 行首仅空白后的 /
  return textBeforeCursor.trimStart() === '/';
}
