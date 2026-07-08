// 配置引导工具。供 bin 入口和 main/TUI 使用。

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-v4-pro';

/** 检查配置文件是否含有 apiKey */
function configFileHasApiKey(path: string): boolean {
  try {
    const cfg = JSON.parse(readFileSync(path, 'utf-8'));
    return Boolean(cfg.apiKey) || (cfg.models?.length > 0 && cfg.models[0].apiKey);
  } catch {
    return false;
  }
}

/** 检查是否有任何形式可用的 apiKey（环境变量 / 用户全局配置 / 项目级配置） */
export function hasApiKey(): boolean {
  if (process.env.HCENT_API_KEY) return true;
  if (configFileHasApiKey(join(homedir(), '.hcent', 'config.json'))) return true;
  return configFileHasApiKey(join(process.cwd(), '.hcent', 'config.json'));
}

/** 返回用户全局配置路径 */
export function userConfigPath(): string {
  return join(homedir(), '.hcent', 'config.json');
}

/** 引导提示文本（供 TUI 在输入栏上方渲染） */
export function setupGuideLines(): string[] {
  return [
    '欢迎使用 hcent！首次运行需要配置 API Key。',
    '',
    '请在下方输入 DeepSeek API Key 开始使用：',
    '',
    `（配置将保存到 ${userConfigPath()}，之后无需重复输入）`,
    '',
    '也可以退出后通过以下方式配置：',
    `  环境变量: HCENT_API_KEY=your-key`,
    `  项目配置: .hcent/config.json`,
    `  命令行向导: hcent --setup`,
  ];
}

/** 将 API Key 写入用户全局配置文件 */
export function writeUserConfig(apiKey: string, baseUrl?: string): void {
  const dir = join(homedir(), '.hcent');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const resolvedBaseUrl = baseUrl?.trim() || DEFAULT_BASE_URL;

  const config = {
    apiKey: apiKey.trim(),
    model: DEFAULT_MODEL,
    baseUrl: resolvedBaseUrl,
    provider: 'deepseek',
    maxLoops: 68,
    timeoutMs: 60_000,
    maxRetries: 2,
    models: [
      {
        name: DEFAULT_MODEL,
        model: DEFAULT_MODEL,
        baseUrl: resolvedBaseUrl,
        apiKey: apiKey.trim(),
        maxContextTokens: 65536,
      },
    ],
    activeModel: DEFAULT_MODEL,
    searchApiKey: '',
  };

  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  process.env.HCENT_API_KEY = apiKey.trim();
}

// ── 保留 --setup 的 readline 交互式配置（TUI 之外也能用） ──

function question(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

export async function runSetup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║     hcent 首次配置向导               ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  console.log('将创建用户全局配置文件，所有项目共享。');
  console.log('');

  const apiKey = await question(rl, 'API Key: ');
  const model = await question(rl, `模型标识 (默认 ${DEFAULT_MODEL}): `);
  const baseUrl = await question(rl, `API Base URL (默认 ${DEFAULT_BASE_URL}): `);

  rl.close();

  writeUserConfig(apiKey, baseUrl);

  console.log('');
  console.log(`配置已写入: ${userConfigPath()}`);
  console.log('现在可以运行 hcent 开始使用。');
  console.log('');
}
