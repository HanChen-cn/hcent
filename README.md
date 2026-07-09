# hcent

终端编码助手 —— 在终端里用自然语言驱动 AI 完成编程任务。

基于 [pi-tui](https://www.npmjs.com/package/@earendil-works/pi-tui) 的交互界面，内置 Agent 循环、10 个文件/Shell 工具、权限确认与 Skill（`/k-xxx`）引用。默认接入 [DeepSeek 官方 API](https://platform.deepseek.com)。

[![npm version](https://img.shields.io/npm/v/hcent)](https://www.npmjs.com/package/hcent)
[![license](https://img.shields.io/npm/l/hcent)](LICENSE)

## 环境要求

- **Node.js** >= 20
- **pnpm**（本地开发推荐，见 `packageManager` 字段）
- 在真实 TTY 终端中运行（不要在非交互管道里用）

## 安装

### 全局安装（推荐）

```bash
npm install -g hcent
```

安装后在**任意目录**执行 `hcent` 即可（工作目录决定 Agent 操作的项目路径）。

验证：

```bash
where hcent       # Windows
which hcent       # macOS / Linux
hcent --setup     # 首次配置 API Key（可选）
```

也可从源码安装（会现场编译，需 Node.js >= 20）：

```bash
npm install -g git+https://github.com/HanChen-cn/hcent.git
```

### 本地开发

```bash
git clone https://github.com/HanChen-cn/hcent.git
cd hcent
pnpm install
pnpm dev          # 开发模式，tsx 直跑 src/
```

全局调试（改代码后需重新编译）：

```bash
pnpm build
pnpm link --global
```

## 首次配置

需要 [DeepSeek API Key](https://platform.deepseek.com/api_keys)。任选一种方式：

| 方式 | 说明 |
|------|------|
| `hcent --setup` | 交互向导，写入 `~/.hcent/config.json` |
| 直接 `hcent` | 无 Key 时 TUI 引导填写 |
| 环境变量 | `HCENT_API_KEY=...` |
| 项目 `.env` | 复制 `.env.example`，放在**当前工作目录**根下 |
| 配置文件 | `~/.hcent/config.json` 或 `<cwd>/.hcent/config.json` |

`hcent` 启动时会读取当前目录下的 `.env`（不覆盖已在 shell 中设置的变量）。

完整配置示例见仓库根目录 [`config.example.json`](config.example.json)。

### 配置优先级

从高到低：

1. 已在 shell 中 `export` 的 `HCENT_*`
2. 项目根目录 `.env`（填充尚未设置的环境变量）
3. 项目 `.hcent/config.json`
4. 用户 `~/.hcent/config.json`
5. 内置默认值

### 常用环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HCENT_API_KEY` | API Key | （必填） |
| `HCENT_MODEL` | 模型标识 | `deepseek-v4-pro` |
| `HCENT_BASE_URL` | API Base URL | `https://api.deepseek.com` |
| `HCENT_SEARCH_API_KEY` | 网络搜索（`websearch` 工具） | 空 |

`provider` 支持 `deepseek`（默认）与 `openai-compatible`。多模型通过 `models[]` 配置，TUI 内 `/model` 热切换。

> API Key 勿提交 Git。`.env` 已在 `.gitignore` 中。

## 使用

```bash
cd your-project    # 进入要操作的项目目录
hcent              # 启动 TUI
```

用自然语言描述任务即可。常用斜杠命令：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/clear` | 清空当前会话 |
| `/model [name]` | 列出或切换模型 |
| `/status` | 查看当前状态 |
| `/save` | 保存会话 |
| `/load [id]` | 加载会话（无 id 时列出） |
| `/sessions` | 列出已保存会话 |
| `/k-xxx` | 引用 skill（如 `/k-flow`），支持一行多个 |
| `/exit` | 退出 |

### 内置工具

| 工具 | 权限 | 说明 |
|------|------|------|
| `ls` `read` `glob` `grep` `tree` `fetch` | 自动 | 浏览、搜索、读取 |
| `write` `edit` `bash` `websearch` | 需确认 | 写入、编辑、Shell、搜索 |

写操作与 Shell 执行前 TUI 会弹出确认；拒绝结果会写入会话上下文。

### Skill 加载目录

后者同名覆盖前者：

`~/.claude/skills` → `~/.cursor/skills` → `~/.agents/skills` → `~/.hcent/skills` → 项目 `.agents` / `.hcent` / `.cursor/skills`

## 开发

```bash
pnpm install
pnpm dev           # 开发运行（--env-file=.env）
pnpm build         # 编译到 dist/
pnpm test          # vitest
pnpm test:watch    # 监听模式
pnpm lint          # ESLint 检查
pnpm lint:fix      # 自动修复（含 import 合并）
```

代码在 `src/`（按模块分子目录），测试在 `test/`（镜像结构，别名 `@` → `src`）。

提交前会经 `lint-staged` 跑 ESLint；规则包括：同文件 import 合并、圈复杂度 ≤ 10、单文件 ≤ 999 行。

架构与模块说明见 [`.kflow/architecture/ARCHITECTURE.md`](.kflow/architecture/ARCHITECTURE.md)。

### 发布到 npm（维护者）

推荐用 **git tag** 触发 GitHub Actions 自动发布（见 `.github/workflows/publish.yml`）：

```bash
# 1. 改 package.json version，提交
git commit -am "chore: release v0.1.1"

# 2. 打 tag 并推送（会触发 CI publish）
git tag v0.1.1
git push origin main --tags
```

仓库需配置 Secret：`NPM_TOKEN`（npm Automation / Granular Access Token）。

本地手动发布：

```bash
pnpm build
npm pack          # 检查 tarball 是否含 dist/
npm publish       # 需 npm 登录且有包名权限
```

发布前 `prepack` 会自动编译；用户 `npm install -g hcent` 时拿到的是预编译 `dist/`。

## License

MIT — 见 [LICENSE](LICENSE)。
