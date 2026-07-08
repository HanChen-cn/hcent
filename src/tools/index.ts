import {
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { execFile as execFileCB } from 'node:child_process';
import { promisify } from 'node:util';

// ── §4.4 ToolSchema（M4 tools 是 canonical source，供 provider / tui 消费）──

export interface ToolSchema {
  name: string;
  description: string;
  parameters: object;
}

const execFile = promisify(execFileCB);

// ── §4.4 工具系统接口 ──

export type ToolPermission = 'auto' | 'confirm';

export interface ToolResult {
  ok: boolean;
  output: string;
  error?: string;
}

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
}

export interface Tool {
  schema: ToolSchema;
  permission: ToolPermission;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolRegistry {
  list(): Tool[];
  schemas(): ToolSchema[];
  get(name: string): Tool | undefined;
}

// ── 路径安全 ──

function safeResolve(cwd: string, target: string): { ok: true; path: string } | { ok: false; error: string } {
  // 拒绝空路径
  if (!target || target.length === 0) {
    return { ok: false, error: '路径不能为空' };
  }

  const resolved = resolve(cwd, target);

  // 拒绝越界访问
  const rel = relative(cwd, resolved);
  if (rel.startsWith('..') || resolve(rel) !== resolve(rel)) {
    return { ok: false, error: `路径越界: ${target}` };
  }

  // Ensure we don't leave via absolute path tricks on Windows
  const rel2 = relative(resolve(cwd), resolved);
  if (rel2.startsWith('..')) {
    return { ok: false, error: `路径越界: ${target}` };
  }

  return { ok: true, path: resolved };
}

function ensureDir(cwd: string, target: string): { ok: true; path: string } | { ok: false; error: string } {
  const resolved = safeResolve(cwd, target);
  if (!resolved.ok) return resolved;

  try {
    const st = statSync(resolved.path);
    if (!st.isDirectory()) {
      return { ok: false, error: `不是目录: ${target}` };
    }
  } catch {
    return { ok: false, error: `目录不存在: ${target}` };
  }

  return resolved;
}

// ── 工具实现 ──

// 1. ls — 目录浏览
const lsTool: Tool = {
  schema: {
    name: 'ls',
    description: '列出目录内容。返回目录中的文件和子目录名（每行一个），失败返回错误信息。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '目录路径，相对于仓库根目录。默认 "."',
        },
      },
    },
  },
  permission: 'auto',

  async run(args, ctx) {
    const dirPath = typeof args.path === 'string' && args.path.length > 0 ? args.path : '.';
    const resolved = ensureDir(ctx.cwd, dirPath);
    if (!resolved.ok) return { ok: false, output: '', error: resolved.error };

    try {
      const entries = readdirSync(resolved.path);
      const lines: string[] = [];

      for (const entry of entries.sort()) {
        try {
          const st = statSync(resolve(resolved.path, entry));
          const suffix = st.isDirectory() ? '/' : '';
          lines.push(`${entry}${suffix}`);
        } catch {
          lines.push(entry);
        }
      }

      return { ok: true, output: lines.join('\n') };
    } catch (err) {
      return { ok: false, output: '', error: `ls 失败: ${String(err)}` };
    }
  },
};

// 2. read — 文件读取
const readTool: Tool = {
  schema: {
    name: 'read',
    description: '读取文件内容。返回文件的完整文本内容，失败返回错误信息。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径，相对于仓库根目录。',
        },
        limit: {
          type: 'number',
          description: '最大读取行数，默认不限制。',
        },
        offset: {
          type: 'number',
          description: '从第几行开始读取（0-based），默认 0。',
        },
      },
      required: ['path'],
    },
  },
  permission: 'auto',

  async run(args, ctx) {
    const filePath = String(args.path ?? '');
    const resolved = safeResolve(ctx.cwd, filePath);
    if (!resolved.ok) return { ok: false, output: '', error: resolved.error };

    try {
      const st = statSync(resolved.path);
      if (st.isDirectory()) {
        return { ok: false, output: '', error: `是目录而非文件: ${filePath}` };
      }
    } catch {
      return { ok: false, output: '', error: `文件不存在: ${filePath}` };
    }

    try {
      const content = readFileSync(resolved.path, 'utf-8');
      const lines = content.split('\n');

      const offset = typeof args.offset === 'number' ? Math.max(0, Math.floor(args.offset)) : 0;
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : undefined;

      const sliced = limit ? lines.slice(offset, offset + limit) : lines.slice(offset);

      return { ok: true, output: sliced.join('\n') };
    } catch (err) {
      return { ok: false, output: '', error: `读取失败: ${String(err)}` };
    }
  },
};

// 3. glob — 文件名匹配
const globTool: Tool = {
  schema: {
    name: 'glob',
    description: '查找匹配指定通配符模式的文件。返回匹配的文件路径列表（每行一个，相对于根目录），失败返回错误信息。',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '通配符模式，如 "**/*.ts" 或 "src/*.test.ts"。',
        },
        path: {
          type: 'string',
          description: '搜索起始目录，相对于仓库根目录。默认 "."',
        },
      },
      required: ['pattern'],
    },
  },
  permission: 'auto',

  async run(args, ctx) {
    const pattern = String(args.pattern ?? '');
    const basePath = typeof args.path === 'string' && args.path.length > 0 ? args.path : '.';
    const resolved = ensureDir(ctx.cwd, basePath);
    if (!resolved.ok) return { ok: false, output: '', error: resolved.error };

    try {
      const results: string[] = [];
      globWalk(resolved.path, ctx.cwd, pattern, results);
      results.sort();
      return { ok: true, output: results.join('\n') };
    } catch (err) {
      return { ok: false, output: '', error: `glob 失败: ${String(err)}` };
    }
  },
};

// 简易 glob 递归遍历
function globWalk(dir: string, root: string, pattern: string, results: string[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = resolve(dir, entry);
    const rel = relative(root, full);

    // 拒绝越界
    if (rel.startsWith('..')) continue;

    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }

    if (matchGlob(rel, pattern)) {
      results.push(rel.replace(/\\/g, '/'));
    }

    if (isDir) {
      // 跳过 node_modules / .git
      if (entry === 'node_modules' || entry === '.git') continue;
      globWalk(full, root, pattern, results);
    }
  }
}

// 简易 glob 匹配（支持 * 和 **）
function matchGlob(str: string, pattern: string): boolean {
  // 将 pattern 转为 regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape specials
    .replace(/\*\*\//g, '<<<GLOBSTAR>>>') // placeholder for **/
    .replace(/\*\*/g, '<<<GLOBSTAR>>>') // ** at end
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*');

  const re = new RegExp(`^${regexStr}$`);
  // Normalize to forward slashes for matching
  const normalized = str.replace(/\\/g, '/');
  return re.test(normalized);
}

// 4. grep — 内容搜索
function parseGrepPattern(pattern: string): RegExp | { error: string } {
  try {
    return new RegExp(pattern, 'g');
  } catch {
    return { error: `无效正则表达式: ${pattern}` };
  }
}

function collectGrepResults(
  targetPath: string,
  cwd: string,
  re: RegExp,
  fileFilter: string | undefined,
): string[] {
  const results: string[] = [];
  const st = statSync(targetPath);
  if (st.isFile()) {
    grepInFile(targetPath, cwd, re, results);
  } else {
    grepWalk(targetPath, cwd, re, fileFilter, results);
  }
  return results;
}

async function runGrep(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pattern = String(args.pattern ?? '');
  const targetPath = typeof args.path === 'string' && args.path.length > 0 ? args.path : '.';
  const fileFilter = typeof args.glob === 'string' && args.glob.length > 0 ? args.glob : undefined;

  const resolved = safeResolve(ctx.cwd, targetPath);
  if (!resolved.ok) return { ok: false, output: '', error: resolved.error };

  const reOrError = parseGrepPattern(pattern);
  if ('error' in reOrError) return { ok: false, output: '', error: reOrError.error };

  try {
    const results = collectGrepResults(resolved.path, ctx.cwd, reOrError, fileFilter);
    return { ok: true, output: results.length === 0 ? '' : results.join('\n') };
  } catch (err) {
    return { ok: false, output: '', error: `grep 失败: ${String(err)}` };
  }
}

const grepTool: Tool = {
  schema: {
    name: 'grep',
    description: '在文件内容中搜索匹配正则表达式的行。返回匹配的文件路径与行内容，失败返回错误信息。',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '正则表达式模式。',
        },
        path: {
          type: 'string',
          description: '搜索起始目录或文件路径，相对于仓库根目录。默认 "."',
        },
        glob: {
          type: 'string',
          description: '过滤文件的通配符模式，如 "*.ts"。',
        },
      },
      required: ['pattern'],
    },
  },
  permission: 'auto',

  run: runGrep,
};

function grepInFile(filePath: string, root: string, re: RegExp, results: string[]) {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }

  const relPath = relative(root, filePath).replace(/\\/g, '/');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      // 重置 lastIndex（因为带 g flag 的 regex 有状态）
      re.lastIndex = 0;
      results.push(`${relPath}:${i + 1}: ${lines[i]}`);
    } else {
      re.lastIndex = 0;
    }
  }
}

function grepWalk(dir: string, root: string, re: RegExp, fileFilter: string | undefined, results: string[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;

    const full = resolve(dir, entry);
    const rel = relative(root, full);
    if (rel.startsWith('..')) continue;

    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }

    if (isDir) {
      grepWalk(full, root, re, fileFilter, results);
    } else if (!fileFilter || matchGlob(rel, fileFilter)) {
      grepInFile(full, root, re, results);
    }
  }
}

// 5. write — 写入/覆盖文件
const writeTool: Tool = {
  schema: {
    name: 'write',
    description: '写入或覆盖文件。将指定内容写入文件（覆盖已有内容），成功返回确认信息，失败返回错误。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '目标文件路径，相对于仓库根目录。',
        },
        content: {
          type: 'string',
          description: '要写入的文件内容。',
        },
      },
      required: ['path', 'content'],
    },
  },
  permission: 'confirm',

  async run(args, ctx) {
    const filePath = String(args.path ?? '');
    const content = String(args.content ?? '');
    const resolved = safeResolve(ctx.cwd, filePath);
    if (!resolved.ok) return { ok: false, output: '', error: resolved.error };

    // 检查父目录
    try {
      const parent = dirname(resolved.path);
      const { mkdirSync } = await import('node:fs');
      mkdirSync(parent, { recursive: true });
    } catch (err) {
      return { ok: false, output: '', error: `无法创建父目录: ${String(err)}` };
    }

    try {
      writeFileSync(resolved.path, content, 'utf-8');
      return { ok: true, output: `已写入: ${filePath}` };
    } catch (err) {
      return { ok: false, output: '', error: `写入失败: ${String(err)}` };
    }
  },
};

// 6. edit — 按字符串替换编辑文件
function replaceFileContent(content: string, oldStr: string, newStr: string, replaceAll: boolean): string | { error: string } {
  const index = content.indexOf(oldStr);
  if (index === -1) return { error: '未找到匹配的 old_string' };
  if (!replaceAll) {
    const secondIndex = content.indexOf(oldStr, index + oldStr.length);
    if (secondIndex !== -1) {
      return { error: 'old_string 出现多次，请使用 replace_all: true 或提供更精确的匹配字符串' };
    }
  }
  return replaceAll
    ? content.split(oldStr).join(newStr)
    : content.slice(0, index) + newStr + content.slice(index + oldStr.length);
}

async function runEdit(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = String(args.path ?? '');
  const oldStr = String(args.old_string ?? '');
  const newStr = String(args.new_string ?? '');
  const replaceAll = args.replace_all === true;

  const resolved = safeResolve(ctx.cwd, filePath);
  if (!resolved.ok) return { ok: false, output: '', error: resolved.error };

  let content: string;
  try {
    content = readFileSync(resolved.path, 'utf-8');
  } catch {
    return { ok: false, output: '', error: `文件不存在: ${filePath}` };
  }

  const nextContent = replaceFileContent(content, oldStr, newStr, replaceAll);
  if (typeof nextContent !== 'string') {
    return { ok: false, output: '', error: nextContent.error };
  }

  try {
    writeFileSync(resolved.path, nextContent, 'utf-8');
    return { ok: true, output: `已编辑: ${filePath}` };
  } catch (err) {
    return { ok: false, output: '', error: `编辑失败: ${String(err)}` };
  }
}

const editTool: Tool = {
  schema: {
    name: 'edit',
    description:
      '在文件中执行精确字符串替换。找到 old_string 的精确匹配并替换为 new_string。仅替换首次出现（或使用 replace_all 替换全部）。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '目标文件路径，相对于仓库根目录。',
        },
        old_string: {
          type: 'string',
          description: '要被替换的原字符串（必须精确匹配，包括缩进）。',
        },
        new_string: {
          type: 'string',
          description: '替换后的新字符串。',
        },
        replace_all: {
          type: 'boolean',
          description: '是否替换所有匹配项，默认仅替换首次出现。',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  permission: 'confirm',

  run: runEdit,
};

// 7. bash — 执行 Shell 命令

const MAX_ERROR_LENGTH = 500;

function sanitizeOutput(text: string): string {
  // 移除不可打印控制字符（保留换行/制表符），清理乱码残留
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function truncateError(text: string): string {
  const cleaned = sanitizeOutput(text);
  if (cleaned.length <= MAX_ERROR_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_ERROR_LENGTH) + '\n…(输出已截断)';
}

const bashTool: Tool = {
  schema: {
    name: 'bash',
    description:
      '执行 Shell 命令。Windows 下使用 PowerShell（UTF-8），Linux/macOS 使用 /bin/sh。返回 stdout 输出，失败返回简洁错误。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的 Shell 命令。',
        },
        timeout: {
          type: 'number',
          description: '超时毫秒数，默认 30000（30 秒）。',
        },
      },
      required: ['command'],
    },
  },
  permission: 'confirm',

  async run(args, ctx) {
    const command = String(args.command ?? '');
    const timeoutMs = typeof args.timeout === 'number' ? args.timeout : 30_000;

    if (command.trim().length === 0) {
      return { ok: false, output: '', error: '命令不能为空' };
    }

    try {
      let shell: string;
      let shellArgs: string[];

      if (process.platform === 'win32') {
        shell = 'powershell.exe';
        shellArgs = [
          '-NoProfile', '-NonInteractive',
          '-Command',
          // 强制 UTF-8 输出编码，避免 GBK 乱码
          `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`,
        ];
      } else {
        shell = '/bin/sh';
        shellArgs = ['-c', command];
      }

      const { stdout, stderr } = await execFile(shell, shellArgs, {
        cwd: ctx.cwd,
        timeout: Math.min(timeoutMs, 600_000),
        maxBuffer: 10 * 1024 * 1024,
        signal: ctx.signal,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });

      const cleanOut = sanitizeOutput(stdout);
      const cleanErr = sanitizeOutput(stderr);
      const output = cleanErr
        ? `${cleanOut}\n[stderr]\n${cleanErr}`
        : cleanOut;

      return { ok: true, output: output.trim() || '(无输出)' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, output: '', error: `命令执行失败: ${truncateError(msg)}` };
    }
  },
};

// ── fetch 工具 ──

function stripHtmlToText(text: string, contentType: string): string {
  if (!contentType.includes('text/html') && !text.includes('<html')) return text;
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function runFetch(args: Record<string, unknown>): Promise<ToolResult> {
  const url = typeof args.url === 'string' ? args.url : '';
  const maxLength = typeof args.maxLength === 'number' ? args.maxLength : 8000;
  if (!url) return { ok: false, output: '', error: 'url 参数不能为空' };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      return { ok: false, output: '', error: `HTTP ${resp.status} ${resp.statusText}` };
    }

    let text = stripHtmlToText(await resp.text(), resp.headers.get('content-type') ?? '');

    if (text.length > maxLength) {
      text = text.slice(0, maxLength) + '\n...[截断]';
    }

    return { ok: true, output: text };
  } catch (err) {
    return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

const fetchTool: Tool = {
  schema: {
    name: 'fetch',
    description: '获取指定 URL 的内容，返回纯文本（自动提取正文，去除 HTML 标签）',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要获取的 URL' },
        maxLength: { type: 'number', description: '最大返回字符数，默认 8000' },
      },
      required: ['url'],
    },
  },
  permission: 'auto',
  run: runFetch,
};

// ── tree 工具 ──

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', '__pycache__']);

function treeDir(dir: string, prefix: string, maxDepth: number, showHidden: boolean, count: { n: number }): string {
  if (maxDepth <= 0 || count.n >= 500) return '';

  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => {
        if (!showHidden && e.name.startsWith('.')) return false;
        if (e.isDirectory() && IGNORE_DIRS.has(e.name)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((e) => e.name);
  } catch {
    return '';
  }

  let result = '';
  for (let i = 0; i < entries.length; i++) {
    if (count.n >= 500) {
      result += `${prefix}...[截断，超过 500 条目]\n`;
      break;
    }

    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    const entry = entries[i];
    count.n++;

    const fullPath = join(dir, entry);
    const isDir = statSync(fullPath).isDirectory();
    result += `${prefix}${connector}${entry}${isDir ? '/' : ''}\n`;

    if (isDir) {
      result += treeDir(fullPath, childPrefix, maxDepth - 1, showHidden, count);
    }
  }
  return result;
}

const treeTool: Tool = {
  schema: {
    name: 'tree',
    description: '以树形结构展示目录内容',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径（相对于项目根目录），默认 "."' },
        maxDepth: { type: 'number', description: '最大递归深度，默认 3' },
        showHidden: { type: 'boolean', description: '是否显示隐藏文件，默认 false' },
      },
      required: [],
    },
  },
  permission: 'auto',
  async run(args, ctx) {
    const target = typeof args.path === 'string' ? args.path : '.';
    const maxDepth = typeof args.maxDepth === 'number' ? args.maxDepth : 3;
    const showHidden = args.showHidden === true;

    const safe = safeResolve(ctx.cwd, target);
    if (!safe.ok) return { ok: false, output: '', error: safe.error };

    try {
      const stat = statSync(safe.path);
      if (!stat.isDirectory()) {
        return { ok: false, output: '', error: `${target} 不是目录` };
      }
    } catch {
      return { ok: false, output: '', error: `目录 ${target} 不存在` };
    }

    const count = { n: 0 };
    const rootName = target === '.' ? '.' : target;
    let output = `${rootName}/\n`;
    output += treeDir(safe.path, '', maxDepth, showHidden, count);

    if (count.n >= 500) {
      output += `\n[已截断，共 ${count.n}+ 条目]`;
    } else {
      output += `\n[${count.n} 个条目]`;
    }

    return { ok: true, output };
  },
};

// ── websearch 工具 ──

function formatWebsearchResults(data: {
  answer?: string;
  results?: Array<{ title: string; url: string; content: string }>;
}): string {
  let output = '';
  if (data.answer) {
    output += `摘要: ${data.answer}\n\n`;
  }
  if (data.results && data.results.length > 0) {
    output += '搜索结果:\n';
    for (const r of data.results) {
      output += `- ${r.title}\n  ${r.url}\n  ${r.content.slice(0, 200)}\n\n`;
    }
  }
  return output || '无搜索结果';
}

async function runWebsearch(args: Record<string, unknown>): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query : '';
  const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 5;
  if (!query) return { ok: false, output: '', error: 'query 参数不能为空' };

  const apiKey = process.env.HCENT_SEARCH_API_KEY ?? '';
  if (!apiKey) {
    return { ok: false, output: '', error: '搜索 API 未配置（设置 HCENT_SEARCH_API_KEY 环境变量）' };
  }

  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      return { ok: false, output: '', error: `搜索 API 返回 ${resp.status}` };
    }

    const data = await resp.json() as {
      answer?: string;
      results?: Array<{ title: string; url: string; content: string }>;
    };

    return { ok: true, output: formatWebsearchResults(data) };
  } catch (err) {
    return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

const websearchTool: Tool = {
  schema: {
    name: 'websearch',
    description: '搜索互联网获取实时信息，返回搜索结果摘要',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        maxResults: { type: 'number', description: '最大返回结果数，默认 5' },
      },
      required: ['query'],
    },
  },
  permission: 'auto',
  run: runWebsearch,
};

// ── ToolRegistry ──

const ALL_TOOLS: Tool[] = [lsTool, readTool, globTool, grepTool, writeTool, editTool, bashTool, fetchTool, treeTool, websearchTool];

export function createToolRegistry(): ToolRegistry {
  const map = new Map<string, Tool>();
  for (const tool of ALL_TOOLS) {
    map.set(tool.schema.name, tool);
  }

  const toolList = [...ALL_TOOLS];

  return {
    list(): Tool[] {
      return toolList;
    },

    schemas(): ToolSchema[] {
      return toolList.map((t) => t.schema);
    },

    get(name: string): Tool | undefined {
      return map.get(name);
    },
  };
}
