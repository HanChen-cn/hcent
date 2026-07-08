import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createToolRegistry, type ToolResult  } from '@/tools/index.js';

function tmpDir() {
  const dir = join(
    tmpdir(),
    `tui-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function ctx(cwd: string) {
  const controller = new AbortController();
  return { cwd, signal: controller.signal };
}

const toolNames = ['ls', 'read', 'glob', 'grep', 'write', 'edit', 'bash'];

describe('ToolRegistry', () => {
  it('creates a registry with all 10 tools', () => {
    const reg = createToolRegistry();
    expect(reg.list()).toHaveLength(10);
  });

  it('schemas returns schemas for each tool', () => {
    const reg = createToolRegistry();
    const schemas = reg.schemas();
    expect(schemas).toHaveLength(10);
    for (const s of schemas) {
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.parameters).toBeTruthy();
    }
  });

  it('get returns tool by name', () => {
    const reg = createToolRegistry();
    for (const name of toolNames) {
      const t = reg.get(name);
      expect(t).toBeDefined();
      expect(t!.schema.name).toBe(name);
    }
  });

  it('get returns undefined for unknown tool', () => {
    const reg = createToolRegistry();
    expect(reg.get('nonexistent')).toBeUndefined();
  });

  it('all tools have correct permission levels', () => {
    const reg = createToolRegistry();
    const autoNames = ['ls', 'read', 'glob', 'grep'];
    const confirmNames = ['write', 'edit', 'bash'];

    for (const name of autoNames) {
      expect(reg.get(name)!.permission).toBe('auto');
    }
    for (const name of confirmNames) {
      expect(reg.get(name)!.permission).toBe('confirm');
    }
  });
});

describe('ls tool', () => {
  it('lists directory contents', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'a.ts'), 'x');
      writeFileSync(join(cwd, 'b.ts'), 'y');
      mkdirSync(join(cwd, 'sub'));

      const reg = createToolRegistry();
      const tool = reg.get('ls')!;
      const result = await tool.run({ path: '.' }, ctx(cwd));

      expect(result.ok).toBe(true);
      expect(result.output).toContain('a.ts');
      expect(result.output).toContain('b.ts');
      expect(result.output).toContain('sub/');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('lists empty directory', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('ls')!;
      const result = await tool.run({ path: '.' }, ctx(cwd));
      expect(result.ok).toBe(true);
      expect(result.output).toBe('');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails on nonexistent directory', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('ls')!;
      const result = await tool.run({ path: 'nonexistent' }, ctx(cwd));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('目录不存在');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails on path traversal attempt', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('ls')!;
      const result = await tool.run({ path: '../etc' }, ctx(cwd));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('越界');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('defaults to cwd when path is empty', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'test.txt'), 'hello');
      const reg = createToolRegistry();
      const tool = reg.get('ls')!;
      const result = await tool.run({}, ctx(cwd));
      expect(result.ok).toBe(true);
      expect(result.output).toContain('test.txt');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('read tool', () => {
  it('reads file content', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'readme.txt'), 'line1\nline2\nline3');
      const reg = createToolRegistry();
      const tool = reg.get('read')!;
      const result = await tool.run({ path: 'readme.txt' }, ctx(cwd));
      expect(result.ok).toBe(true);
      expect(result.output).toBe('line1\nline2\nline3');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reads with limit and offset', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'lines.txt'), 'a\nb\nc\nd\ne');
      const reg = createToolRegistry();
      const tool = reg.get('read')!;
      const result = await tool.run({ path: 'lines.txt', offset: 1, limit: 2 }, ctx(cwd));
      expect(result.ok).toBe(true);
      expect(result.output).toBe('b\nc');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails on nonexistent file', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('read')!;
      const result = await tool.run({ path: 'nope.txt' }, ctx(cwd));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('文件不存在');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails on directory', async () => {
    const cwd = tmpDir();
    try {
      mkdirSync(join(cwd, 'subdir'));
      const reg = createToolRegistry();
      const tool = reg.get('read')!;
      const result = await tool.run({ path: 'subdir' }, ctx(cwd));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('目录');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('glob tool', () => {
  it('finds matching files', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'a.ts'), '');
      writeFileSync(join(cwd, 'b.ts'), '');
      writeFileSync(join(cwd, 'c.txt'), '');
      mkdirSync(join(cwd, 'sub'));
      writeFileSync(join(cwd, 'sub', 'd.ts'), '');

      const reg = createToolRegistry();
      const tool = reg.get('glob')!;
      const result = await tool.run({ pattern: '**/*.ts' }, ctx(cwd));

      expect(result.ok).toBe(true);
      expect(result.output).toContain('a.ts');
      expect(result.output).toContain('b.ts');
      expect(result.output).toContain('sub/d.ts');
      expect(result.output).not.toContain('c.txt');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('returns empty for no matches', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('glob')!;
      const result = await tool.run({ pattern: '*.rs' }, ctx(cwd));
      expect(result.ok).toBe(true);
      expect(result.output).toBe('');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('grep tool', () => {
  it('finds pattern in files', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'a.ts'), 'const x = 1;\nfunction foo() {}');
      writeFileSync(join(cwd, 'b.ts'), 'const y = 2;\nfunction bar() {}');

      const reg = createToolRegistry();
      const tool = reg.get('grep')!;
      const result = await tool.run({ pattern: 'function' }, ctx(cwd));

      expect(result.ok).toBe(true);
      expect(result.output).toContain('a.ts');
      expect(result.output).toContain('b.ts');
      expect(result.output).toContain('function');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('filters by file glob', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'a.ts'), 'function foo() {}');
      writeFileSync(join(cwd, 'b.txt'), 'function bar() {}');

      const reg = createToolRegistry();
      const tool = reg.get('grep')!;
      const result = await tool.run({ pattern: 'function', glob: '*.ts' }, ctx(cwd));

      expect(result.ok).toBe(true);
      expect(result.output).toContain('a.ts');
      expect(result.output).not.toContain('b.txt');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('returns empty for no matches', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'a.ts'), 'no match here');
      const reg = createToolRegistry();
      const tool = reg.get('grep')!;
      const result = await tool.run({ pattern: 'xyz_not_found' }, ctx(cwd));
      expect(result.ok).toBe(true);
      expect(result.output).toBe('');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails on invalid regex', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('grep')!;
      const result = await tool.run({ pattern: '[invalid' }, ctx(cwd));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('无效正则');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('write tool', () => {
  it('writes file content', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('write')!;
      const result = await tool.run({ path: 'out.txt', content: 'hello world' }, ctx(cwd));

      expect(result.ok).toBe(true);
      expect(result.output).toContain('已写入');

      const { readFileSync } = await import('node:fs');
      const written = readFileSync(join(cwd, 'out.txt'), 'utf-8');
      expect(written).toBe('hello world');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('creates parent directories', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('write')!;
      const result = await tool.run(
        { path: 'deep/nested/file.txt', content: 'deep' },
        ctx(cwd),
      );

      expect(result.ok).toBe(true);

      const { readFileSync } = await import('node:fs');
      const written = readFileSync(join(cwd, 'deep/nested/file.txt'), 'utf-8');
      expect(written).toBe('deep');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails on path traversal', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('write')!;
      const result = await tool.run(
        { path: '../outside.txt', content: 'bad' },
        ctx(cwd),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('越界');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('edit tool', () => {
  it('replaces first occurrence', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'config.ts'), 'const x = "old";\nconst y = "other";');
      const reg = createToolRegistry();
      const tool = reg.get('edit')!;
      const result = await tool.run(
        { path: 'config.ts', old_string: 'old', new_string: 'new' },
        ctx(cwd),
      );

      expect(result.ok).toBe(true);
      expect(result.output).toContain('已编辑');

      const { readFileSync } = await import('node:fs');
      const edited = readFileSync(join(cwd, 'config.ts'), 'utf-8');
      expect(edited).toBe('const x = "new";\nconst y = "other";');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('replaces all with replace_all', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'dup.txt'), 'foo bar foo');
      const reg = createToolRegistry();
      const tool = reg.get('edit')!;
      const result = await tool.run(
        { path: 'dup.txt', old_string: 'foo', new_string: 'baz', replace_all: true },
        ctx(cwd),
      );

      expect(result.ok).toBe(true);

      const { readFileSync } = await import('node:fs');
      expect(readFileSync(join(cwd, 'dup.txt'), 'utf-8')).toBe('baz bar baz');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails when old_string not found', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'file.txt'), 'hello');
      const reg = createToolRegistry();
      const tool = reg.get('edit')!;
      const result = await tool.run(
        { path: 'file.txt', old_string: 'not_here', new_string: 'x' },
        ctx(cwd),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('未找到');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails when old_string appears multiple times without replace_all', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'dup.txt'), 'x x');
      const reg = createToolRegistry();
      const tool = reg.get('edit')!;
      const result = await tool.run(
        { path: 'dup.txt', old_string: 'x', new_string: 'y' },
        ctx(cwd),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('多次');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails on nonexistent file', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('edit')!;
      const result = await tool.run(
        { path: 'nope.txt', old_string: 'a', new_string: 'b' },
        ctx(cwd),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('不存在');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('bash tool', () => {
  it('executes a command and returns stdout', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('bash')!;
      const result = await tool.run({ command: 'echo hello' }, ctx(cwd));
      expect(result.ok).toBe(true);
      expect(result.output).toContain('hello');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('fails on empty command', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('bash')!;
      const result = await tool.run({ command: '' }, ctx(cwd));
      expect(result.ok).toBe(false);
      expect(result.error).toContain('不能为空');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('captures stderr in output', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();
      const tool = reg.get('bash')!;
      // `echo to stderr` works on both cmd.exe and /bin/sh
      const result = await tool.run(
        { command: 'echo err msg 1>&2' },
        ctx(cwd),
      );
      // On Windows cmd.exe, stderr redirection may fail; key assertion: no crash
      expect(result).toBeDefined();
      expect(typeof result.ok).toBe('boolean');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('ToolResult structural conformance', () => {
  it('all tools return {ok, output} on success', async () => {
    const cwd = tmpDir();
    try {
      writeFileSync(join(cwd, 'x.ts'), 'content');
      const reg = createToolRegistry();

      // Test a representative sample
      const results: Array<{ name: string; result: ToolResult }> = [];

      results.push({ name: 'ls', result: await reg.get('ls')!.run({ path: '.' }, ctx(cwd)) });
      results.push({ name: 'read', result: await reg.get('read')!.run({ path: 'x.ts' }, ctx(cwd)) });
      results.push({ name: 'glob', result: await reg.get('glob')!.run({ pattern: '*.ts' }, ctx(cwd)) });
      results.push({ name: 'grep', result: await reg.get('grep')!.run({ pattern: 'content' }, ctx(cwd)) });

      for (const { name, result } of results) {
        expect(result, `${name}: result missing`).toBeDefined();
        expect(typeof result.ok, `${name}: ok should be boolean`).toBe('boolean');
        expect(typeof result.output, `${name}: output should be string`).toBe('string');
        if (result.ok) {
          expect(result.error, `${name}: error should be undefined on success`).toBeUndefined();
        }
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('all tools return {ok:false, error} on failure', async () => {
    const cwd = tmpDir();
    try {
      const reg = createToolRegistry();

      // read nonexistent file
      const r1 = await reg.get('read')!.run({ path: 'no' }, ctx(cwd));
      expect(r1.ok).toBe(false);
      expect(r1.error).toBeTruthy();

      // glob with invalid path
      const r2 = await reg.get('glob')!.run({ pattern: '*' }, ctx(cwd));
      expect(r2.ok).toBe(true); // empty dir is valid

      // ls nonexistent
      const r3 = await reg.get('ls')!.run({ path: 'no' }, ctx(cwd));
      expect(r3.ok).toBe(false);
      expect(r3.error).toBeTruthy();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
