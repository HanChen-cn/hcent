#!/usr/bin/env node
// hcent — 终端编码助手 CLI 入口
// 配置来源：项目 .env > 项目 .hcent/config.json > 用户 ~/.hcent/config.json > 默认值

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 加载项目根目录的 .env（不在 pnpm dev --env-file 下也能工作）
function loadDotEnv() {
  try {
    const dotEnvPath = join(process.cwd(), '.env');
    const content = readFileSync(dotEnvPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env 不存在则忽略
  }
}

loadDotEnv();

import { run } from './main.js';
import { runSetup } from './setup/index.js';

async function main(): Promise<void> {
  if (process.argv.slice(2).includes('--setup')) {
    await runSetup();
    return;
  }

  await run();
}

main();
