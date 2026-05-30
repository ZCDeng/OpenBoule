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
| U4 工作流引擎 | `c456f51` | ✅ | 真 BullMQ+真 PG 整合：9-phase happy 全跑通 / 每 phase checkpoint 暂停 / 审批后继续 / fan-out partial（researcher 失败不阻塞）/ redo 重排 / 双 approve→409。21 新测（state 纯机 + checkpoint CAS/lease/幂等/事件 + engine 整合），全套 53 绿 |
| U5 确定性 PM 逻辑 | （本次） | ✅ | invariant helper（url-dedup / coverage / grep / language-gate / cost-calc）+ KTD-21 裁决核心（adjudicate 四态/顺序即正确性/弃权归一）+ config 从真值源解析（不硬编码）。23 新测（含对真实缓存 SKILL.md/editor.md 回归 + cost 真 PG），全套 76 绿 |

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

## U5 落地说明

- **黑话清单严格从真值源读**：`config.parseJargonPatterns` 锚定 `roles/editor.md` filter-1 的 `grep -noE`
  清单（含 `axis|basis|cohort|...|H[1-5]\.[0-9]|Phase [0-9]`），解析不到即抛错——绝不静默兜底空表
  （空表 = language-gate 永远放行 = 静默失效）。阈值 FETCH_BUDGET/VERIFY_CAP/REFUTATIONS_REQUIRED 同样解析自 SKILL.md。
- **language-gate ↔ U4 放行闸**：`languageGate(clientText).passed===false` 即 Phase 4 放行闸 `EditorRound.languageGateFailed`
  的真实来源（U4 暂由注入 agentRunner 的 score 提供，U6 wire 时接真）。`adjudicate` 四态 + composite 是 Phase 2.5 source-verifier 裁决的真实来源。
- **本单元仅做「确定性逻辑」**：mode→axis 默认模板、dispatch matrix 这类**纯数据表**配置（plan U5 列为真值源配置）
  其消费方是 workflow 创建/fan-out 派发（U6/U7），现在解析属未测的投机代码——故 defer 到消费方接入时，
  避免造无人调用的解析器（rule 2 simplicity / rule 12 不造假）。

## 下一步

- **U6 API 网关层**：REST + 认证 + 项目 RBAC + 审批 checkpoint + SSE + 签名分享 + publication/stub guard + surface-cache。
  依赖 U1/U3/U4/U5（均就绪）。这里把 U4 引擎、U5 helper、U2 真值源 wire 成对外 HTTP，
  并接 language-gate→放行闸、adjudicate→2.5、cost-calc→成本面板的真实数据流。
- 未决：Open Q 13（messages-api 裸 key 端到端对照，需 `ANTHROPIC_API_KEY`）；git remote 是否建。
