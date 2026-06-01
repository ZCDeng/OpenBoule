# OpenConsult — AI 驱动的咨询工作台

> **开发代号 Boule。** 把 9 阶段 × 多角色创作团队 Web 化。接案、调研、综合、三筛、交付——每一步都留下可追溯的来源与裁决记录。

<p align="center">
  <a href="https://github.com/ZCDeng/OpenBoule/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/ZCDeng/OpenBoule?style=for-the-badge&labelColor=0d1117&color=1A18EE&logo=github&logoColor=white" /></a>
  <a href="https://github.com/ZCDeng/OpenBoule/issues"><img alt="Issues" src="https://img.shields.io/github/issues/ZCDeng/OpenBoule?style=for-the-badge&labelColor=0d1117&color=ff6b6b&logo=github&logoColor=white" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=for-the-badge&labelColor=0d1117" /></a>
</p>

<p align="center">
  <a href="https://zcdeng.github.io/OpenBoule"><img alt="Landing" src="https://img.shields.io/badge/landing-在线预览-1A18EE?style=for-the-badge" /></a>
  <a href="#capabilities"><img alt="Capabilities" src="https://img.shields.io/badge/能力-8%20项-black?style=for-the-badge" /></a>
  <a href="#roles"><img alt="Roles" src="https://img.shields.io/badge/角色-7%20个-black?style=for-the-badge" /></a>
</p>

---

## 一句话

OpenConsult 把咨询交付变成一条**流水线**。你不是在等一个模型写出一篇长文，而是在调度一支多角色创作团队——每个角色有明确的阶段、工具集和交付标准。

## 能力矩阵

| # | 能力 | 说明 |
|---|---|---|
| **01** | 确定性脚手架 | Phase 0 秒级生成项目骨架与目录。该用代码答的判断，绝不空转 agent。 |
| **02** | 多角色 agent 编排 | researcher / strategy / editor / designer 按 7+2 阶段 DAG 分工，fan-out 并发、串行放行闸，合议交付。 |
| **03** | 真实联网检索 | researcher 接 Aditly MCP（安思派 / 博查 / Jina / Reach）真检索，带来源 URL 落进报告，不靠模型记忆编造。 |
| **04** | 对抗验证三票 | source-verifier 对每条断言独立三票裁决，refute 优先。站不住的论据当场出局。 |
| **05** | AI persona 访谈 | atypica-research 生成 3–5 个 AI persona 深度访谈，抽取用户痛点与决策动机（basis 标 simulated，占比 ≤20%）。 |
| **06** | Web-CLI 协同 | `boule mcp` 把本地 Claude Code / Cursor 接进 workflow；`--local` 免登录单机起；项目可关联本地 git repo，agent 直接在真实文件夹里干活。 |
| **07** | 可审计实时进度 | 工作流实时事件只暴露工具调用、token 用量、阶段状态；agent 的思考过程和高频文本块在落库前就被滤掉。盯得住进度，泄不出模型内部。 |
| **08** | 输入材料与产物分离 | 客户给的参考资料（references）走独立通道上传，映射 Skill 的 `sources/`，启动工作流时冻结快照；不和 agent 生成的 artifact 混在一起。来源可追，产物可信。 |

## 角色编队

每个角色是一份独立的 skill prompt，引擎自动接管编排。新增一个角色 = 一份 `roles/your-role.md` + 一条 dispatch 映射。

| 角色 | 阶段 | 职责 |
|---|---|---|
| 行业研究员 | Phase 2 | 按轴真检索，带来源 URL |
| 对抗声称验证 | Phase 2.5 | 三票裁决，refute 优先 |
| 战略顾问 | Phase 3 | 合成结构化报告 |
| 审稿编辑 | Phase 4 | 串行三筛 + 语言闸门 |
| 设计师 | Phase 5 | 排版交付 |
| 市场扫描员 | Phase 6 | 热点扫描，回灌调研轴 |
| 信息架构师 | Phase 0 | 梳理目录与产物结构 |

## Web-CLI 协同层

Web 当指挥中心，本地 CLI 当执行器。重度用户已经在本地跑 Claude Code，里面有完整的项目上下文和记忆——不该逼他们切到浏览器里重新输一遍。

| 能力 | 怎么用 |
|---|---|
| **MCP 桥** | `boule mcp` 起一个 stdio MCP server，暴露 7 个 tool（`list_projects` / `get_workflow` / `submit_artifact` …）。Claude Code 里直接「把这份调研提交到 Boule」，产物出现在 Web 待审批队列。 |
| **Active Context** | MCP 工具不传 project/workflow 时，自动命中你在 Web UI 当前打开的那个。CLI 和 Web 之间不用来回贴 id。 |
| **本地免登录** | `MODE=local` 起，跳过 JWT、单用户、只监听 `127.0.0.1`（带 Host 头校验防 DNS 重绑定）。先体验再决定要不要建团队。 |
| **Thin CLI** | `boule` 命令，零依赖。`boule submit --workflow <id> --type research --file r.md` 这类脚本化场景；`boule mcp` 复用同一个 server。 |
| **Git-linked** | 项目关联本地 git repo，agent 的 cwd 指向真实文件夹（锁死子树不外放），产出物天然进版本控制。仅本地模式；团队项目走 `gitUrl` clone 到服务端。 |
| **认证分层** | Web 走 JWT cookie；MCP / CLI 走 `Authorization: Bearer bk_…`（project-scoped + read/write，可撤销，只存 hash）。 |

本地创建的项目可以 export 成一个 bundle，登录后 import 到团队空间（owner 重映射到导入者）。

> 设计取舍写在 `docs/plans/2026-05-31-002-feat-web-cli-bridge-plan.md`：本地模式原想用 SQLite 做到零基础设施，spike 发现 62 处 Postgres 专用 SQL 挡路，退回 docker PG——保留「零注册」，放弃「零基础设施」。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + Vite 6 + Tailwind v4 |
| API | Fastify + BullMQ + Drizzle ORM |
| 数据库 | Postgres 16 + Redis |
| Agent 运行时 | Claude Agent SDK `query()` |
| Web 检索 | Aditly MCP（安思派 / 博查 / Jina / Reach）|
| AI 访谈 | atypica-research MCP |
| CLI ↔ Agent | `@modelcontextprotocol/sdk`（stdio MCP server）+ Thin CLI `boule` |

## 快速开始

```bash
git clone https://github.com/ZCDeng/OpenBoule.git
cd OpenBoule
cp .env.example .env
# 编辑 .env 填入数据库和 Redis 配置
docker compose up -d   # PG + Redis
pnpm install
pnpm dev               # api@3100 + web@5173
```

## 项目结构

```
apps/api/     — Fastify API + BullMQ 工作流引擎 + Agent 执行器 + MCP server（src/mcp/）
apps/web/     — React 前端（公开落地页 + 工作台）
packages/cli/ — Thin CLI `boule`（零依赖，复用 apps/api 的 MCP server）
skills-cache/ — 角色 skill prompt（从 consulting-team 仓库同步）
docs/         — 架构文档、计划、进度
```

## Landing 页

[👉 在线预览](https://zcdeng.github.io/OpenBoule)

野性现代（Brutalist neo-grotesque）风格：超大粗体、电光蓝 accent、原始黑边、非对称网格。包含项目介绍、能力矩阵、角色编队、底层运行时、方法论 7+2 阶段、用户登录。

## License

Apache-2.0
