/**
 * npm/pnpm install 生命周期：
 * - 无 dist/ 时编译（git+ 全局安装、本地 clone 后 install）
 * - 有 .git/ 时注册 simple-git-hooks（仅开发者仓库）
 * - 从 npm 装到的包已含 dist/，跳过编译
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const hasDist = existsSync('dist/bin.js');
const isGitRepo = existsSync('.git');

if (!hasDist) {
  console.log('[hcent] dist/ 不存在，正在编译…');
  execSync('npx tsc', { stdio: 'inherit' });
}

if (isGitRepo) {
  execSync('npx simple-git-hooks', { stdio: 'inherit' });
}
