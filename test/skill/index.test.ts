import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSkillRegistry } from '@/skill/index.js';
import { createCommandPalette } from '@/skill/command-palette.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

function tmpDir() {
  const dir = join(tmpdir(), `tui-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('SkillRegistry', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads skill from .md file with frontmatter', async () => {
    writeFileSync(join(dir, 'test-skill.md'), `---
name: test-skill
description: 测试技能
triggers: [test, 测试]
---

这是一个测试 skill 的 prompt 内容。`);

    const registry = createSkillRegistry();
    await registry.loadFromDirectory(dir);

    expect(registry.list()).toHaveLength(1);
    expect(registry.get('test-skill')).toBeDefined();
    expect(registry.get('test-skill')!.description).toBe('测试技能');
    expect(registry.get('test-skill')!.triggers).toEqual(['test', '测试']);
    expect(registry.get('test-skill')!.prompt).toBe('这是一个测试 skill 的 prompt 内容。');
  });

  it('skips files without frontmatter', async () => {
    writeFileSync(join(dir, 'no-frontmatter.md'), 'This is not a skill file.');

    const registry = createSkillRegistry();
    await registry.loadFromDirectory(dir);

    expect(registry.list()).toHaveLength(0);
  });

  it('skips files without prompt content', async () => {
    writeFileSync(join(dir, 'empty.md'), `---
name: empty
description: 空
triggers: []
---`);

    const registry = createSkillRegistry();
    await registry.loadFromDirectory(dir);

    expect(registry.list()).toHaveLength(0);
  });

  it('handles nonexistent directory', async () => {
    const registry = createSkillRegistry();
    await registry.loadFromDirectory('/nonexistent/dir');
    expect(registry.list()).toHaveLength(0);
  });

  it('loads skill from subdirectory with SKILL.md', async () => {
    const subDir = join(dir, 'my-skill');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'SKILL.md'), `---
name: sub-skill
description: 子目录中的技能
triggers: [sub, 子目录]
---

子目录 SKILL.md 的 prompt 内容。`);

    const registry = createSkillRegistry();
    await registry.loadFromDirectory(dir);

    expect(registry.list()).toHaveLength(1);
    const skill = registry.get('sub-skill');
    expect(skill).toBeDefined();
    expect(skill!.description).toBe('子目录中的技能');
    expect(skill!.prompt).toBe('子目录 SKILL.md 的 prompt 内容。');
  });

  it('match returns skill by trigger word', async () => {
    writeFileSync(join(dir, 'review.md'), `---
name: code-review
description: 代码审查
triggers: [review, 审查]
---

审查模式。`);

    const registry = createSkillRegistry();
    await registry.loadFromDirectory(dir);

    expect(registry.match('请帮我 review 这段代码')?.name).toBe('code-review');
    expect(registry.match('审查一下')?.name).toBe('code-review');
    expect(registry.match('unrelated')).toBeUndefined();
  });

  it('match prefers exact match over contains', async () => {
    writeFileSync(join(dir, 'a.md'), `---
name: skill-a
description: A
triggers: [review]
---

A`);
    writeFileSync(join(dir, 'b.md'), `---
name: skill-b
description: B
triggers: [code review]
---

B`);

    const registry = createSkillRegistry();
    await registry.loadFromDirectory(dir);

    // exact match 'code review' should win over contains 'review'
    expect(registry.match('code review')?.name).toBe('skill-b');
  });

  it('fuzzySearch returns matching skills', async () => {
    writeFileSync(join(dir, 'cr.md'), `---
name: code-review
description: 代码审查专家
triggers: [review]
---

审查。`);
    writeFileSync(join(dir, 'db.md'), `---
name: debug
description: 调试助手
triggers: [debug]
---

调试。`);

    const registry = createSkillRegistry();
    await registry.loadFromDirectory(dir);

    const results = registry.fuzzySearch('review');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('code-review');
  });

  it('fuzzySearch returns all when query is empty', async () => {
    writeFileSync(join(dir, 'a.md'), `---
name: a
description: A
triggers: [a]
---

A`);

    const registry = createSkillRegistry();
    await registry.loadFromDirectory(dir);

    expect(registry.fuzzySearch('')).toHaveLength(1);
  });
});

describe('CommandPalette', () => {
  it('entries includes builtin commands and skills', async () => {
    const dir = tmpDir();
    try {
      writeFileSync(join(dir, 'test.md'), `---
name: my-skill
description: 我的技能
triggers: [test]
---

测试。`);

      const registry = createSkillRegistry();
      await registry.loadFromDirectory(dir);
      const palette = createCommandPalette(registry);

      const entries = palette.entries();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((e) => e.type === 'command' && e.name === 'help')).toBe(true);
      expect(entries.some((e) => e.type === 'skill' && e.name === 'my-skill')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('search filters entries by query', () => {
    const registry = createSkillRegistry();
    const palette = createCommandPalette(registry);

    const results = palette.search('model');
    expect(results.some((e) => e.name === 'model')).toBe(true);
    expect(results.some((e) => e.name === 'help')).toBe(false);
  });

  it('search returns all when query is empty', () => {
    const registry = createSkillRegistry();
    const palette = createCommandPalette(registry);

    const all = palette.entries();
    const searched = palette.search('');
    expect(searched.length).toBe(all.length);
  });
});
