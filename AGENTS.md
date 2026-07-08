# AGENTS.md

本仓库使用 **kflow** 工作流体系管理软件生命周期。任何 AI 编码助手在本仓库工作前，请遵循以下入口约定。

## 启动必读

1. 先读 `.kflow/attention.md` —— 项目硬约束与注意事项。
2. 需要体系总览时读 `.kflow/reference/system-overview.md`。
3. 路径与命名约定以 `.kflow/reference/shared-conventions.md` 为权威。

## 目录结构

```
.kflow/
├── attention.md       启动必读的项目注意事项
├── requirements/      需求实体
├── architecture/      架构实体（ARCHITECTURE.md 为总入口）
├── roadmap/           大需求规划层
├── features/          新增能力 spec（design / impl / accept）
├── issues/            修 bug spec（report / analyze / fix）
├── compound/          知识沉淀（learning / trick / decision / explore）
├── tools/             跨工作流共享脚本
└── reference/         跨子技能共享参考
```

## 工作流

- 新增能力：`k-feat-design` → `k-feat-impl` → `k-feat-accept`
- 修 bug：`k-issue-report` → `k-issue-analyze` → `k-issue-fix`
- 大需求规划：`k-roadmap`
- 知识沉淀：`k-learn` / `k-trick` / `k-decide` / `k-explore`

不清楚从哪开始就触发 `k-flow`。
