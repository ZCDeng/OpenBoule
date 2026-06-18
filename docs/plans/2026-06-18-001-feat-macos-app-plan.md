---
title: "feat: Boule 本地 macOS app（Electron + PGlite + Material3）"
type: feat
status: active
date: "2026-06-18"
origin: 用户 /goal 指令（本会话）
---

# feat: Boule 本地 macOS app（Electron + PGlite + Material3）

## Summary

把 Boule 从「docker 依赖的 Web 工作台」打成一个**双击即用、零基础设施的本地 macOS app**：Electron 外壳，后端用 **PGlite（进程内 Postgres）+ 进程内队列**替掉 Postgres/Redis docker 依赖，前端**全站重皮成 Google Material3** 设计系统，并新增 5 类交互重点——新建项目、输入/输出物管理、格式转换、配置管理、前后台状态与消息通知。

## 已锁定的架构决策（本会话与用户确认）

1. **外壳 = Electron**。后端是重型 Node 服务（Fastify+BullMQ+Agent SDK+OCR 原生依赖），Electron 原生宿主 Node，现有 Fastify 几乎零改动跑在子进程，pg/tesseract 等原生依赖最易打包。
2. **数据层 = PGlite + 进程内队列**。真正零基础设施。
3. **视觉 = 全站重皮 Material3**。落地页可保留 brutalist，登录后工作台整体换 M3。

## 去风险结论（spike 已完成）

`spikes/pglite-compat/`（RESULTS.md）实测：PGlite 支持后端**全部**高风险 PG 特性——`make_interval`、`pg_advisory_xact_lock`/`hashtext`、`bigserial`、`jsonb_set`/`@>`、`xmax`、ENUM+`ADD VALUE`、CTE/window、`FOR UPDATE`、`ON CONFLICT RETURNING`。`drizzle-orm/pglite` 适配器在仓库现装 drizzle 0.38.4 里现成。
→ **SQL 层几乎零改动**。数据层主要工作量是「进程内队列复刻 BullMQ parent-child fan-out」，且单进程免去分布式恢复，比原估大幅降低。
唯一注意点：PGlite 单次 `query()` 不能塞多语句，手写 `BEGIN;…;COMMIT;` 字符串要改 `exec()`/事务 API（Drizzle 事务不受影响）。

---

## 现状盘点要点

**后端 Redis 用途（除 BullMQ 外都低风险单进程化）**
- BullMQ 队列 + FlowProducer parent-child（Phase2 fan-out 5 researcher）+ lease/heartbeat/recovery — `workflow/engine.ts`、`queues.ts`。**主要工作量**。
- SSE 一次性 ticket — `services/sse.ts`、`routes/sse.ts`。→ 内存 Map+TTL。
- 文档单写者锁（Lua）— `services/doc-lock.ts`。→ 连接级内存锁或 DB 行锁。
- 分享 token 撤销集 + 限流 — `services/share-token.ts`。→ DB 列 / 内存计数。
- MCP active-context 心跳 — `mcp/active-context.ts`。已有 local 文件模式。
- **SSE 已是 DB-backed（无 Redis pub/sub）**，单进程迁移最省心。

**前端（重皮入口干净，但三块要新建）**
- `src/index.css` 的 `--boule-*` 是单一 token 源，组件薄壳 100% 走变量——改 token 一处全站生效。
- 页面 8 个：Landing/Login/Projects/ProjectDetail/Workflow/Methodology/Settings/Share。
- **缺口**：无通知/Toast 系统、无后台任务状态 store、无格式转换/导出 UI——都要新建。
- 现有交互：新建项目 `pages/Projects.tsx`；输入物 `views/ProjectInputs/`；输出物 `views/DocumentWorkspace/`；格式选择 `components/InteractiveTrackPicker.tsx`；⌘K `components/CommandPalette.tsx`；SSE `lib/sse.ts`。

---

## 分阶段实施（每阶段独立可验证，按依赖排序）

### P1 — 数据层迁移（零基础设施后端）  ← 命门，先做
- P1.1 db client 抽象：`db/client.ts` 支持 PGlite 驱动（`drizzle-orm/pglite`），dataDir 落用户目录；保留 pg 驱动走环境开关，便于团队模式不回归。
- P1.2 迁移执行：`db/migrate.ts` 在 PGlite 上跑现有 8 个迁移；排查多语句字符串。
- P1.3 进程内队列：实现 `workflow/inproc-queue.ts`，复刻 BullMQ 用到的子集——单队列多 job 名、并发度、FlowProducer parent-child（children 全完成触发 parent，`ignoreDependencyOnFailure` 缺失补 null）、job 重试（fixed backoff）。单进程，删 stalled/recovery 分布式逻辑。`engine.ts`/`queues.ts` 改接口不改编排语义。
- P1.4 Redis 小工具内存化：ticket（Map+TTL）、doc-lock（连接级 Map）、撤销集（DB 列）、限流（内存窗口）、active-context（复用 local 文件模式）。
- P1.5 配置：`config.ts` 增 `RUNTIME=local-app` 模式，免 JWT、单用户、不连 Redis。
- **验收**：`docker` 全关，后端单进程起；现有 api 测试在 local-app 模式全绿（多 worker recovery 相关测试按单进程语义调整）；端到端建项目→phase0 scaffold→phase2 fan-out 真跑。

### P2 — Electron 外壳 + 打包
- P2.1 新建 `apps/desktop`（Electron 主进程）：app 启动时 spawn 后端（local-app 模式）、健康检查后加载 web build；退出时优雅关停后端 + PGlite。
- P2.2 用户数据目录：PGlite 数据、references 文件、配置落 `app.getPath('userData')`。
- P2.3 原生集成：菜单栏、Dock、`Notification`（系统通知，承接后端事件）、深链。
- P2.4 打包：electron-builder 出 `.dmg`；处理 pg/tesseract/pdfjs 原生依赖与 tessdata 随包；签名/公证留 TODO（需开发者证书）。
- **验收**：`.dmg` 安装后双击启动，无需 docker/Node，完成一次建项目→跑 phase→看实时进度。

### P3 — Material3 设计系统基座
- P3.1 重建 `index.css` token：M3 color roles（primary/secondary/tertiary/error + container/on-* 全套）、动态色种子、elevation（5 级 + tonal surface）、shape scale、M3 typescale、state-layer opacity、motion token（standard/emphasized easing + duration）。light/dark 双 scheme（复用现有 `theme.ts` 三态切换）。
- P3.2 `.boule-*` 类迁移到 M3 token；新增 M3 组件：Button（filled/tonal/outlined/text）、TextField（outlined/filled+浮标）、Card（elevated/filled/outlined）、Chip、Dialog、Tabs（带 indicator 动画）、ListItem、NavigationRail/Bar。
- **验收**：8 页面在亮/暗下 M3 化无错位；token 改一处全站生效；对照 M3 规范走查。

### P4 — 5 类交互强化（M3 组件之上）
- P4.1 新建项目：M3 引导流（Dialog/分步），关联本地 git repo、选交付轨预设。
- P4.2 输入/输出物管理：拖拽上传 + 进度、解析状态 M3 chip、输出物（artifact）列表/版本/预览 ListItem 化。
- P4.3 格式转换：artifact 导出 UI（Markdown/HTML/PDF；接 InteractiveTrack 的 5 轨），M3 Dialog 选格式 + 进度。
- P4.4 配置管理：Settings M3 化 + 配置预设编辑（运行模式/模型/搜索服务/API Key/OCR 参数）。
- P4.5 前后台状态与通知：新建 `stores/notification.ts`（Snackbar 队列）+ `stores/tasks.ts`（后台任务状态）；SnackbarContainer；后台任务面板（M3 ListItem + 进度）；接 Electron 系统通知（窗口失焦时 phase 完成/待审批弹原生通知）。
- **验收**：5 类交互各走一遍真实流程；通知在前台 Snackbar、后台系统通知；权限/错误统一走 toast。

### P5 — 收尾
- 打包体积优化、首启迁移引导、崩溃恢复、文档（README 增「本地 app」段）、features.json 记录 F-macos。

---

## 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 进程内队列复刻 BullMQ fan-out 语义有偏差 | 中 | 只复刻 engine 实际用到的子集；保留现有 checkpoint/DB 真值源做兜底；针对 fan-out 写专门测试 |
| Electron 打包原生依赖（pg native/tesseract/pdfjs）| 中 | local-app 走 PGlite 后 `pg` 可不打包；tessdata 随包；electron-builder `asarUnpack` 原生模块 |
| M3 全站重皮回归（暗色/落地页）| 中 | token 单一源 + 逐页走查；落地页定向保留 |
| 单进程并发正确性（原多 worker 假设）| 低 | 单用户本地场景并发低；保留 DB CAS 关键路径 |
| 签名/公证需开发者证书 | 低 | P2 先出未签名可本地运行版，签名留证书就绪后 |

## 不做（YAGNI）
- 不做团队/多用户云端模式的回归改造（保留 env 开关即可）。
- 不追求多进程分布式队列恢复（本地单进程不需要）。
- 不在本轮做自动更新（auto-updater）。
