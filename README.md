# hcent

终端编码助手 —— 在终端里用自然语言驱动 AI 完成编程任务。

## 环境要求

- **Node.js** >= 20
- 终端需支持 TTY（在真正的终端窗口中运行，不要在非交互管道里用）

## 安装

### 全局安装（推荐）

安装后在**任意目录**均可运行 `hcent`：

```bash
# 从 npm Registry 安装（发布后可用）
npm install -g hcent

# 或从 Git 仓库安装
npm install -g git+<仓库 URL>
```

验证命令是否在 PATH 中：

```bash
where hcent       # Windows
which hcent       # macOS / Linux
```

### 本地开发

```bash
git clone <仓库 URL>
cd hcent
pnpm install
pnpm dev          # 开发模式，直接跑 TypeScript 源码
```

全局调试（改代码后需 `pnpm build`）：

```bash
pnpm build
pnpm link --global
```

## 首次配置

首次运行需要配置 **DeepSeek 官方 API Key**。任选一种方式即可。

### 方式一：交互向导（推荐）

```bash
hcent --setup
```

配置写入 `~/.hcent/config.json`，所有项目共享。

### 方式二：直接启动 TUI

```bash
cd your-project
hcent
```

未配置 API Key 时，TUI 会引导你在输入框中填写，同样保存到 `~/.hcent/config.json`。

### 方式三：环境变量

```bash
# Windows PowerShell
$env:HCENT_API_KEY = "your-api-key"

# macOS / Linux
export HCENT_API_KEY=your-api-key
```

### 方式四：项目级 `.env`

在项目根目录创建 `.env`（参考 `.env.example`）：

```env
HCENT_API_KEY=your-api-key
HCENT_MODEL=deepseek-v4-pro
HCENT_BASE_URL=https://api.deepseek.com
```

`hcent` 启动时会自动读取**当前工作目录**下的 `.env`。

### 方式五：配置文件

| 作用域 | 路径 | 说明 |
|--------|------|------|
| 用户全局 | `~/.hcent/config.json` | 所有项目默认使用 |
| 项目级 | `<cwd>/.hcent/config.json` | 仅在该目录及子目录运行时生效 |

项目级配置会覆盖用户全局配置中的同名字段。

## 配置优先级

从高到低：

1. 环境变量 `HCENT_*`（含已在 shell 中 export 的变量）
2. 项目根目录 `.env`（仅填充尚未设置的环境变量）
3. 项目 `.hcent/config.json`
4. 用户 `~/.hcent/config.json`
5. 内置默认值

### 常用环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HCENT_API_KEY` | API Key | （必填） |
| `HCENT_MODEL` | 模型标识 | `deepseek-v4-pro` |
| `HCENT_BASE_URL` | API Base URL | `https://api.deepseek.com` |
| `HCENT_SEARCH_API_KEY` | 搜索工具 API Key | 空（未配置时搜索工具不可用） |

### 配置文件示例

`~/.hcent/config.json`：

```json
{
  "apiKey": "your-api-key",
  "model": "deepseek-v4-pro",
  "baseUrl": "https://api.deepseek.com",
  "provider": "deepseek",
  "maxLoops": 68,
  "timeoutMs": 60000,
  "maxRetries": 2,
  "activeModel": "deepseek-pro",
  "models": [
    {
      "name": "deepseek-pro",
      "model": "deepseek-v4-pro",
      "baseUrl": "https://api.deepseek.com",
      "apiKey": "your-api-key",
      "maxContextTokens": 65536
    },
    {
      "name": "deepseek-flash",
      "model": "deepseek-v4-flash",
      "baseUrl": "https://api.deepseek.com",
      "apiKey": "your-api-key",
      "maxContextTokens": 65536
    }
  ]
}
```

> API Key 等敏感信息请勿提交到 Git。`.env` 已在 `.gitignore` 中忽略。

## 使用

```bash
cd your-project    # 进入要操作的项目目录
hcent              # 启动 TUI
```

在 TUI 中用自然语言描述任务即可。常用斜杠命令：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/clear` | 清空当前会话 |
| `/model [name]` | 列出或切换模型 |
| `/status` | 查看当前状态 |
| `/save [title]` | 保存会话 |
| `/load [id]` | 加载已保存会话 |
| `/k-xxx` | 引用 skill（如 `/k-flow`） |
| `/exit` | 退出 |

## 开发

```bash
pnpm install
pnpm dev           # 开发运行
pnpm build         # 编译到 dist/
pnpm test          # 运行测试
```

## License

MIT
