import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config/index.js';
import { createSession } from './session/index.js';
import { createProviderManager } from './provider/provider-manager.js';
import { createSessionStore } from './session/session-store.js';
import { createSkillRegistry } from './skill/index.js';
import { createCommandPalette } from './skill/command-palette.js';
import { createToolRegistry } from './tools/index.js';
import { hasApiKey } from './setup/index.js';
import { runPiTuiApp } from './tui/index.js';

export async function run(): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const needsSetup = !hasApiKey();

  const session = createSession(
    '你是一个终端编码助手（hcent）。你可以帮用户分析代码、查找文件、执行操作。',
  );

  const providerManager = createProviderManager(config);
  const store = createSessionStore(undefined, [config.apiKey]);
  const toolRegistry = createToolRegistry();

  const skillRegistry = createSkillRegistry();
  const home = homedir();
  // 用户级 skill（低优先级）
  await skillRegistry.loadFromDirectory(join(home, '.claude', 'skills'));
  await skillRegistry.loadFromDirectory(join(home, '.cursor', 'skills'));
  await skillRegistry.loadFromDirectory(join(home, '.agents', 'skills'));
  await skillRegistry.loadFromDirectory(join(home, '.hcent', 'skills'));
  // 项目级 skill（同名覆盖用户级）
  await skillRegistry.loadFromDirectory(join(cwd, '.agents', 'skills'));
  await skillRegistry.loadFromDirectory(join(cwd, '.hcent', 'skills'));
  await skillRegistry.loadFromDirectory(join(cwd, '.cursor', 'skills'));

  const palette = createCommandPalette(skillRegistry);

  runPiTuiApp({
    config,
    session,
    providerManager,
    tools: toolRegistry,
    store,
    palette,
    skillRegistry,
    needsSetup,
  });
}
