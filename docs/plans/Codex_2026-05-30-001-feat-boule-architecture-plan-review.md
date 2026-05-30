# Codex Review: Boule Architecture Plan

> 日期：2026-05-30
> 审查对象：`docs/plans/2026-05-30-001-feat-boule-architecture-plan.md`
> 来源需求：`docs/brainstorms/2026-05-30-boule-architecture-requirements.md`
> 结论：REQUEST CHANGES

## Scope

本审查覆盖需求与实施计划的一致性、关键技术决策自洽性、长期 agent 工作流可靠性、真值源唯一性、实施顺序、验证充分性和明显安全风险。

本次只做文档级审查，没有修改原计划，也没有做运行验证。

## Findings

### 1. CRITICAL: 签名链接 token 设计不可实现

位置：
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:55`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:666`

问题：
计划把 token 定义为 `HMAC(scope + workflow_id + expiry + nonce, secret)`，但验证流程又要求从 token 中解析 `scope`、`workflow_id`、`expiry`、`nonce`。纯 HMAC 摘要不可逆，无法解析 payload。

影响：
R4 的签名只读分享链路按当前方案无法实现。后续实现时很可能临时补成不安全的 server-side 猜测逻辑或弱 token 方案。

建议：
改成以下二选一：
- Opaque random token + 服务端持久化记录。
- `base64url(payload).base64url(mac)` 签名信封，并做常量时间校验、过期检查、撤销表和访问限流。

### 2. HIGH: 缺少 run 级真值源快照

位置：
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:320`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:323`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:730`

问题：
计划采用启动拉取、5 分钟轮询、热重载，但没有在 workflow/run 创建时固定真值源版本。文档里同时出现“定时同步”和“deploy 时拉取 + 版本锁定”，策略不一致。

影响：
同一个 run 的不同 phase、retry、redo 可能跑在不同 skill 版本上。历史回放、CLI 对比、事故复盘和客户交付可解释性都会失真。

建议：
在 workflow 创建时固化 `truth_snapshot`，至少包含：
- commit SHA
- 必要文件 manifest
- 文件 hash
- 运行期实际使用的 prompt/tool/config 引用

所有 phase、retry、redo 只读该快照。新同步内容只影响后续新建 run。

### 3. HIGH: workflow 恢复策略会造成重复执行和重复成本

位置：
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:392`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:393`

问题：
恢复策略是扫描 `status = 'running'` 且 `updated_at` 超过 5 分钟的 workflow，然后重新 enqueue 当前 phase。该策略没有 phase attempt lease、幂等键、BullMQ job 对账，也没有限制只有一个 attempt 能写 side effect。

影响：
长 phase 或慢 worker 可能被误判为失联，导致重复 agent 调用、重复 token 成本、重复 artifact、状态机错乱。

建议：
补充运行时可靠性设计：
- `phase_attempts` 表或等价结构
- attempt lease / heartbeat
- idempotency key
- 恢复前核对 BullMQ job 状态
- artifact 和状态写入使用 write-once 或 compare-and-swap
- 只有失联 attempt 才允许接管

### 4. HIGH: 方法论行为被重新编码进代码，破坏真值源唯一

位置：
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:353`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:438`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:440`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:441`

问题：
计划把 `mode -> axis` 模板匹配、`axis -> lane` 路由、2.4 synthesis、2.5 claim 选择/投票/裁决、phase 5 导出顺序、role `allowedTools` 等写入代码。这些并不都是稳定的确定性 PM helper，很多会随 skill 方法论演进。

影响：
改 `roles/*.md` 或相关 skill 文档后，Boule 仍需改代码，直接破坏“真值源唯一”和长期 agent 工作流可靠性。

建议：
收缩代码职责到 invariant helper：
- `normURL`
- coverage check
- grep / language gate
- cost calculation
- checkpoint plumbing
- artifact/version plumbing

随 skill 演进的 dispatch、routing、prompt policy、tool policy 应来自真值源快照或显式配置，而不是写死在 Boule 代码中。

### 5. HIGH: 文档编辑缺少 artifact lineage 和下游消费契约

位置：
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:610`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:629`

问题：
R3 要求“编辑持久化并喂给下游 phase”。计划只在 UI 层描述“仅保存”或“保存并重跑下游”，没有后端输入版本、失效传播、phase 依赖图、下游读取哪个 artifact 版本的契约。U9 依赖也只写 U7，没有依赖 workflow/artifact 服务。

影响：
可能出现“文档能改，但下游仍吃旧版本”或“重跑范围不确定”的返工。

建议：
补一个 artifact lineage / phase input snapshot 设计：
- 每个 phase 记录输入 artifact 版本集合。
- 编辑 phase N 产出后，明确哪些 phase 标记 stale。
- 用户选择 rerun 时明确 rerun 范围。
- 下游 phase 读取新版本必须有端到端测试覆盖。

### 6. HIGH: 最大可行性风险没有前置为实施 gate

位置：
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:336`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:722`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:723`

问题：
`ClaudeSDKClient` headless 稳定性、`roles/*.md` 里其他 skill/tool 的解析能力、并发 job 隔离、cost attribution，是整个架构成立条件。计划将其列为高风险，但没有前置成强制 spike/gate。

影响：
如果 Agent SDK 服务端执行或 tool/skill 装载不可行，后续 U4/U6/U8/U9 都会大面积返工。

建议：
在 U1/U3 前增加 `U0 Feasibility Spike`，退出条件至少包括：
- 从 truth cache 加载一个真实 role prompt。
- 服务端 headless 跑通真实 role。
- 必需 tools/skills 可解析或有明确降级边界。
- 并发 job 会话隔离成立。
- usage/cost 能按 job 归账。
- executor 实际消费 workflow 创建时固化的 truth snapshot。

### 7. MEDIUM: Phase 2.5 四态裁决被静默降级

位置：
- `docs/brainstorms/2026-05-30-boule-architecture-requirements.md:114`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:593`

问题：
需求明确把 Phase 2.5 四态裁决作为工作台专门视图，计划却写成“不建独立视图”，折叠在 Run 时间线 checkpoint 详情里。

影响：
高密度验证信息会被埋掉，和 fail loud 目标冲突，也削弱顾问解释验证过程的能力。

建议：
恢复独立 verdict 视图。若确实降级，需在 traceability 中显式标为 scope cut，并说明验收口径变化。

### 8. MEDIUM: 报告交付范围前后不一致

位置：
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:590`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:623`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:675`
- `docs/plans/2026-05-30-001-feat-boule-architecture-plan.md:681`

问题：
一处写“预览支持 HTML / PDF 切换”，另一处写 v1 不承诺 PDF/deck，测试里又写 “HTML report 导出 PDF”。

影响：
U9/U10 的实现顺序和验收口径会摇摆，容易返工。

建议：
现在就定死 v1 范围：
- 若 v1 是 HTML-only，删除 PDF/deck 相关验收和测试。
- 若 v1 保留 PDF，则补最小导出链路、隔离策略和端到端验证。

## Additional Checks

我额外核对了相关官方资料，发现计划里还有几处需要谨慎：

- BullMQ Flow 默认语义不是“子任务失败后自然 partial aggregate”。如果要 partial results，需要显式设计 child failure 处理，例如 `ignoreDependencyOnFailure`、`continueParentOnFailure` 或等价失败聚合协议。
- Claude Agent SDK 文档支持 `allowedTools`、hooks、`maxTurns`、`maxBudgetUsd` 等能力，但这也意味着 U0 spike 必须验证真实 role/tool/skill 装载，而不能只做 mock executor。
- GitHub REST 未认证请求有限额；`raw.githubusercontent.com` 也不应被设计成“无需 API key、无限速率限制”的可靠生产依赖。真值源同步应支持 token、commit pin、缓存和失败降级。

## Minimum Fix Set

建议先改计划，不急于进入实现。最小修正集合：

1. 增加 `U0 Feasibility Spike`，验证 Agent SDK headless、tool/skill 装载、并发隔离、成本归账。
2. 增加 workflow 创建时的 `truth_snapshot` 设计。
3. 增加 `phase_attempt`、lease、heartbeat、幂等写入和恢复对账设计。
4. 增加 artifact lineage / phase input snapshot / stale propagation 设计。
5. 修正签名链接 token 方案。
6. 收缩代码化方法论边界，避免破坏真值源唯一。
7. 明确 Phase 2.5 verdict 视图和 PDF/deck 是否属于 v1。

## References

- BullMQ Flows: https://docs.bullmq.io/guide/flows
- BullMQ failure flow handling: https://docs.bullmq.io/guide/flows/ignore-dependency
- Claude Agent SDK TypeScript: https://platform.claude.com/docs/pt-BR/agent-sdk/typescript
- GitHub REST API rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
