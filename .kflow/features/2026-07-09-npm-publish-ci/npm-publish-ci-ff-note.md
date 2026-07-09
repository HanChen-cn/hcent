---
doc_type: feature-ff-note
feature: npm-publish-ci
date: 2026-07-09
requirement:
tags: [ci, npm, release]
---

## 做了什么
用 GitHub Actions 在推送 `v*` tag 时自动发布 npm；版本升到 0.1.1，并补齐发布说明。

## 改了哪些
- `.github/workflows/publish.yml` — tag 触发 lint / test / npm publish
- `package.json` — version `0.1.0` → `0.1.1`
- `README.md` / `.kflow/attention.md` — 发布流程与 Secret 说明
- `.npmrc.example` / `.gitignore` — 发布 token 不进仓库

## 怎么验证的
本地 `pnpm build` + `pnpm test`；`npm publish` 发布 `0.1.1`；后续靠 tag + `NPM_TOKEN` 走 CI。

## 顺手发现（可选，不阻塞）
- `pnpm-lock.yaml` 在 `.gitignore` 中，CI 用 `--frozen-lockfile=false`；若要可复现构建可考虑提交 lockfile
