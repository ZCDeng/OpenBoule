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
| U5 确定性 PM 逻辑 | `47363f7` | ✅ | invariant helper（url-dedup / coverage / grep / language-gate / cost-calc）+ KTD-21 裁决核心（adjudicate 四态/顺序即正确性/弃权归一）+ config 从真值源解析（不硬编码）。23 新测（含对真实缓存 SKILL.md/editor.md 回归 + cost 真 PG），全套 76 绿 |
| U6 API 网关层 | （本次） | ✅ | Fastify 网关 wire U2/U4/U5：自建 JWT(HS256)+scrypt 认证 / 四级 RBAC / publication+stub 护栏 / opaque 分享 token(404/410/429) / surface 写授权(editor+,external·viewer 拒) / SSE 一次性 ticket + Last-Event-ID 续传 + 重连重新鉴权。11 新测（app.inject 真 PG+Redis + 真引擎 E2E 注册→项目→workflow→逐 checkpoint 审批→完成），全套 87 绿 |

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

## U6 落地说明

- **密码用 stdlib scrypt 而非 bcrypt**（已注释）：避免 node-gyp 原生构建与 pnpm onlyBuiltDependencies/Node
  strip-only 摩擦，安全等价（memory-hard KDF）。JWT 手写 HS256（stdlib crypto，零依赖，符合 KTD-10 自建）。
- **写入收口 tripwire 按设计触发**：routes/workflows.ts 写 truth_snapshot 被 U2 write-funnel.guard 逮到 →
  已 review 并入 ALLOWLIST；同时**移除路由里伪造 snapshot 的兜底**，改为缺 snapshotProvider 即 503
  （值必须源自 createFrozenSnapshot，绝不在路由构造）。
- **引擎加 per-instance queueName**：多租户/测试隔离用；E2E 用唯一队列名避免与 U4 engine.test 并行抢 job。
- **组合根 + 生产 agentRunner 暂缓**：listen() 入口 + 真 agentRunner（role 名→role 文件映射）依赖 U5 deferred 的
  dispatch matrix，现在写属投机未测代码。U6 交付**完全测过的网关 + 引擎 wiring**，E2E inject 已等价跑通
  plan Verification 的「注册→项目→workflow→checkpoint→审批→完成」。
- **SSE 流式成功路径**走 hijack（inject 测不了会挂）——故测**鉴权/授权失败**(401/403/404) + **回放服务**
  （replayEvents 只补 id>lastEventId / authorizeSse 降权→403），覆盖 plan 续传不重投不漏投。

## 下一步

- **U7 前端骨架**：Vite + React 19 + 路由 + Zustand/React Query + useSSE(Last-Event-ID 续传) + CheckpointCard +
  6 态规范。依赖 U1/U6（API 就绪）。
- 未决：Open Q 13（messages-api 裸 key 端到端对照，需 `ANTHROPIC_API_KEY`）；git remote 是否建；
  组合根（server.ts listen + 生产 agentRunner role 映射，随 dispatch matrix）。
