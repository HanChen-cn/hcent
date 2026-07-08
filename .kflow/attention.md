# Attention

本文件是 kflow 技能启动必读的项目注意事项入口。所有 kflow 子技能开始工作前必须读取它。

## 项目碎片知识

<!-- k-note managed: 用 k-note 维护，新条目按下面分节追加 -->

### 编译与构建

- 语言：TypeScript；编译：`pnpm build`（`tsc` → `dist/`）。
- Node.js ≥ 20；包管理：`pnpm`。

### 运行与本地起服务

- TUI 框架：@earendil-works/pi-tui。
- 开发：`pnpm dev`（`--env-file=.env` + tsx 直跑 `src/bin.ts`）。
- 安装后：`hcent`（编译产物 `dist/bin.js`）；`bin.ts` 也会自动加载项目根 `.env`。
- 首次无 API Key：`hcent --setup` 或 TUI 引导写入 `~/.hcent/config.json`。

### 测试

- 命令：`pnpm test`（vitest）；`pnpm test:watch` 监听模式。
- 覆盖重点：Agent 主循环、工具调用与回传、权限确认/拒绝、配置合并、Mock Provider。
- TUI 测试在非 TTY（vitest / CI）可能打印 pi-tui 噪音，以 `Tests N passed` 为准。

### 命令与脚本陷阱

- Git commit：Conventional Commits（`feat:`/`fix:`/`refactor:`/`chore:`/`docs:`/`test:`），描述中文、术语保留英文。
- `pnpm prepare` 会执行 `build` 并注册 `simple-git-hooks`；pre-commit 跑 `lint-staged`。
- **Lint 不通过不允许 commit**（见下方 ESLint 规则）。

### 路径与目录约定

- 源码：`src/`，按模块分子目录（`config/`、`agent/`、`provider/` 等），主入口 `index.ts`。
- 测试：`test/`，镜像 `src/` 结构；vitest 别名 `@` → `src`。
- 产物：`dist/`（发布）；可选验证输出放 `deliverables/`。
- Cursor 协作记录由 IDE 管理，hcent 运行时不落盘。
- CodeGraph 索引 `src/` 与 `.kflow/tools/`；`test/` 已排除。大重构后：`npx codegraph index -f`。

### 环境变量与凭证

- `.env` 放项目根，不提交 git；`HCENT_API_KEY` 等见 `.env.example`。
- 默认 LLM：DeepSeek 官方 OpenAI 兼容 API（`https://api.deepseek.com`），默认模型 `deepseek-v4-pro`。
- 配置优先级：项目 `.env` > `HCENT_*` 环境变量 > 项目 `.hcent/config.json` > 用户 `~/.hcent/config.json` > 默认值。
- `provider`：`deepseek`（默认）与 `openai-compatible`；多模型 `models[]` + TUI `/model` 热切换。
- API Key 不得进日志、会话历史明文；`SessionStore` 保存时脱敏。

### 其他

- **ESLint**（`eslint.config.js`）：同一模块 import 合并一行；单函数圈复杂度 ≤ 10；单文件 ≤ 999 行。
- **权限**：`ls`/`read`/`glob`/`grep`/`fetch`/`tree` 自动执行；`write`/`edit`/`bash`/`websearch` 须用户确认；拒绝结果写入会话。
- Agent `maxLoops` 默认 68，超限写 error 并停止。

### Skill 引用（hcent TUI）

- 输入框 **`/k-xxx`** 引用 skill（如 `/k-flow`），一行可多个；仅 `/k-xxx` 无其他文字时只写指针、不启动 agent。
- Session 注入 **SKILL.md 路径指针**（渐进式披露），非全文 prompt；agent 自行 `read`。
- 加载目录（后者同名覆盖前者）：`~/.claude/skills`、`~/.cursor/skills`、`~/.agents/skills`、`~/.hcent/skills` → 项目 `.agents`、`.hcent`、`.cursor/skills`。
