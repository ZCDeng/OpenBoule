# Boule 进度

> 更新：2026-05-31
> Plan：`docs/plans/2026-05-30-001-feat-boule-architecture-plan.md`

## 已完成（git 为准）

| 单元 | commit | 状态 | 真跑验证 |
|---|---|---|---|
| U0 Feasibility Spike | `9cca391` | ✅ | 5/5 退出条件（Agent SDK headless / 并发隔离 / 真值源快照 / 6 事件映射）。见 `spikes/RESULTS.md` |
| plan 回填 U0 发现 | `4ebac0a` | ✅ | 5 处真跑发现回填（私有 repo token 强制 / query() 命名 / 裸 key 待验 / 成本量级 / thinking_delta） |
| U1 基础设施与数据层 | `a5719b5` | ✅ | docker compose（PG16+Redis7 AOF）→ 12 表迁移 → 幂等重跑 → 连接失败优雅退出 |
| U2 真值源同步 | `8f5bc10` | ✅ | live 拉私有 repo 9 文件 + 缓存一致 + 降级 + drift + token fail-loud；13 单测 |
| U3 Agent SDK 执行器 | `05cb98d` | ✅ | claude-sdk live 生产路径；32 单测（含 runtime-contract）；messages-api 裸 key 对照挂 Open Q 13 |
| U4 工作流引擎 | （本次） | ✅ | 真 BullMQ+真 PG 整合：9-phase happy 全跑通 / 每 phase checkpoint 暂停 / 审批后继续 / fan-out partial（researcher 失败不阻塞）/ redo 重排 / 双 approve→409。21 新测（state 纯机 + checkpoint CAS/lease/幂等/事件 + engine 整合），全套 53 绿 |

## 环境状态

- git 本地 repo（分支 `feat/u0-feasibility-spike`），**无 remote**（未建 GitHub origin）
- Docker：`boule-postgres`(本机端口 5442) + `boule-redis`(6389, AOF) 运行中、已迁移
- 本机 `.env`（gitignored）端口改 5442/6389 避冲突；committed `.env.example` 保持 5432/6379
- auth：claude CLI 订阅会话（SDK live 用）；`GITHUB_TOKEN` 用 `gh auth token`；无 `ANTHROPIC_API_KEY`
- 测试：`pnpm --filter @boule/api test`（node:test，零额外依赖，45 测试全绿）

## U4 两处落地偏离（plan 草拟 vs 实现，已留痕）

- **recovery CAS**：plan 草拟「in-place 推进 `attempt_number` 当判别字段」。实现改为
  **原子作废旧 attempt（leased/running→failed，guard lease 已过）当判别 + 新 attempt 号重 enqueue**。
  理由：与 worker 侧幂等 `recordAttempt`（建行模型）干净组合，免 owner 跨 worker 交接；plan 要的
  全部性质（DB 写裁单赢家 / 不重复 enqueue / attempt 推进 / recovery_reason 留痕）均保留。见
  `checkpoint.ts: recoverCAS` 注释。
- **Phase 4 serial**：3 editor 在单个 phase4 job 内顺序跑（serial 顺序 + 放行闸 + below_threshold 兜底全保留），
  plan 的「每 editor 独立 job + waitUntilFinished 链」作后续细化——phase 才是恢复单元，分 job 对可靠性无增益。
- **recoverStalled** 已实现（findOrphanAttempts + recoverCAS 单赢家 + 重 enqueue），boot 兜底 + 运行期轮询皆可调；
  真 BullMQ「服务器重启恢复」端到端用例待 U6 进程编排接好后补（当前 CAS 单赢家已在 checkpoint.test 真跑覆盖）。

## 下一步

- **U5 确定性 PM 逻辑**：normURL 去重 / coverage check / grep 自检 / 成本计算 / 语言闸门。
  其中语言闸门 + coverage 评分正是 Phase 4 放行闸 `EditorRound{composite,mustFix,languageGateFailed}` 的真实来源
  （U4 暂由注入 agentRunner 的 score 提供）。
- 未决：Open Q 13（messages-api 裸 key 端到端对照，需 `ANTHROPIC_API_KEY`）；git remote 是否建。
