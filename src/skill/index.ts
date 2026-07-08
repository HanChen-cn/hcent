import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Skill {
  name: string;
  description: string;
  triggers: string[];
  prompt: string;
  filePath: string;
}

export interface SkillRegistry {
  list(): Skill[];
  get(name: string): Skill | undefined;
  match(userInput: string): Skill | undefined;
  fuzzySearch(query: string): Skill[];
  loadFromDirectory(dir: string): Promise<void>;
}

function parseSkillFile(filePath: string): Skill | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = match[1];
    const prompt = match[2].trim();
    if (!prompt) return null;

    const name = extractField(frontmatter, 'name');
    const description = extractField(frontmatter, 'description');
    const triggersRaw = extractField(frontmatter, 'triggers');

    if (!name || !description) return null;

    let triggers: string[] = [];
    if (triggersRaw) {
      const arrMatch = triggersRaw.match(/^\[(.*)\]$/);
      if (arrMatch) {
        triggers = arrMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
      } else {
        triggers = [triggersRaw];
      }
    }

    return { name, description, triggers, prompt, filePath };
  } catch {
    return null;
  }
}

function extractField(frontmatter: string, key: string): string | null {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(regex);
  return match ? match[1].trim() : null;
}

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

function scoreTriggerMatch(input: string, trigger: string): number {
  const t = trigger.toLowerCase();
  if (input === t) return 3;
  if (input.startsWith(t)) return 2;
  if (input.includes(t)) return 1;
  return 0;
}

function isBetterSkillMatch(
  priority: number,
  triggerLen: number,
  bestPriority: number,
  bestTriggerLen: number,
): boolean {
  return priority > bestPriority || (priority === bestPriority && triggerLen > bestTriggerLen);
}

function findBestSkillMatch(skills: Map<string, Skill>, userInput: string): Skill | undefined {
  const input = userInput.trim().toLowerCase();
  if (!input) return undefined;

  let best: Skill | undefined;
  let bestPriority = -1;

  for (const skill of skills.values()) {
    for (const trigger of skill.triggers) {
      const priority = scoreTriggerMatch(input, trigger);
      if (priority === 0) continue;
      if (isBetterSkillMatch(priority, trigger.length, bestPriority, best?.triggers[0]?.length ?? 0)) {
        bestPriority = priority;
        best = skill;
      }
    }
  }

  return best;
}

export function createSkillRegistry(): SkillRegistry {
  const skills = new Map<string, Skill>();

  return {
    list(): Skill[] {
      return [...skills.values()];
    },

    get(name: string): Skill | undefined {
      return skills.get(name);
    },

    match(userInput: string): Skill | undefined {
      return findBestSkillMatch(skills, userInput);
    },

    fuzzySearch(query: string): Skill[] {
      if (!query) return [...skills.values()];

      const results: { skill: Skill; score: number }[] = [];
      for (const skill of skills.values()) {
        const fields = [skill.name, skill.description, ...skill.triggers];
        let bestScore = Infinity;
        for (const field of fields) {
          const result = subsequenceMatch(query, field);
          if (result.matched && result.score < bestScore) {
            bestScore = result.score;
          }
        }
        if (bestScore < Infinity) {
          results.push({ skill, score: bestScore });
        }
      }

      return results.sort((a, b) => a.score - b.score).map((r) => r.skill);
    },

    async loadFromDirectory(dir: string): Promise<void> {
      if (!existsSync(dir)) return;

      // 方式1：子目录 skill（每个子文件夹下有 SKILL.md）
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillFile = join(dir, entry.name, 'SKILL.md');
          const skill = parseSkillFile(skillFile);
          if (skill) {
            skills.set(skill.name, skill);
          }
        }
      }

      // 方式2：平铺 .md 文件（兼容旧格式）
      const flatFiles = readdirSync(dir).filter((f) => f.endsWith('.md'));
      for (const file of flatFiles) {
        const skill = parseSkillFile(join(dir, file));
        if (skill) {
          skills.set(skill.name, skill);
        }
      }
    },
  };
}
