import { describe, it, expect } from 'vitest';
import {
  buildSkillPointerContent,
  extractSkillReferences,
  extractSlashTokenAtCursor,
  hasUserContentBeyondSkills,
  shouldTriggerSlashMenu,
} from '@/skill/skill-pointer.js';
import type { Skill } from '@/skill/index.js';

const kFlow: Skill = {
  name: 'k-flow',
  description: 'kflow 统一入口',
  triggers: [],
  prompt: 'full prompt should not be injected',
  filePath: 'C:\\Users\\me\\.claude\\skills\\k-flow\\SKILL.md',
};

const kFeat: Skill = {
  name: 'k-feat',
  description: '新增能力路由',
  triggers: [],
  prompt: 'feat prompt',
  filePath: 'C:\\Users\\me\\.claude\\skills\\k-feat\\SKILL.md',
};

function lookup(name: string): Skill | undefined {
  if (name === 'k-flow') return kFlow;
  if (name === 'k-feat') return kFeat;
  return undefined;
}

describe('skill-pointer', () => {
  it('builds pointer content without full prompt', () => {
    const content = buildSkillPointerContent(kFlow);
    expect(content).toContain('k-flow');
    expect(content).toContain(kFlow.filePath);
    expect(content).toContain('渐进式披露');
    expect(content).not.toContain('full prompt');
  });

  it('extracts multiple skill references in order', () => {
    const text = '先用 /k-feat 设计 todolist，然后用 /k-flow 路由';
    const { skills, unknown } = extractSkillReferences(text, lookup);
    expect(skills.map((s) => s.name)).toEqual(['k-feat', 'k-flow']);
    expect(unknown).toEqual([]);
  });

  it('dedupes repeated skill references', () => {
    const text = '/k-feat foo /k-feat bar';
    const { skills } = extractSkillReferences(text, lookup);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('k-feat');
  });

  it('reports unknown skills', () => {
    const { unknown } = extractSkillReferences('/k-unknown /k-feat', lookup);
    expect(unknown).toEqual(['k-unknown']);
  });

  it('detects user content beyond skill refs', () => {
    expect(hasUserContentBeyondSkills('/k-feat 想要 todolist')).toBe(true);
    expect(hasUserContentBeyondSkills('/k-feat')).toBe(false);
    expect(hasUserContentBeyondSkills('/k-feat /k-flow')).toBe(false);
  });

  it('extracts inline slash token after CJK punctuation', () => {
    expect(extractSlashTokenAtCursor('/k-arch 你好。/k')).toBe('/k');
    expect(extractSlashTokenAtCursor('/k-arch 你好。/k-issue')).toBe('/k-issue');
    expect(extractSlashTokenAtCursor('/help')).toBe('/help');
    expect(extractSlashTokenAtCursor('./src/foo')).toBeNull();
  });

  it('shouldTriggerSlashMenu after Chinese period', () => {
    expect(shouldTriggerSlashMenu('/k-arch 你好。/')).toBe(true);
    expect(shouldTriggerSlashMenu('/')).toBe(true);
    expect(shouldTriggerSlashMenu('foo /')).toBe(true);
  });
});
