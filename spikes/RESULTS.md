# U0 Feasibility Spike — 结果

> 日期：2026-05-30
> Plan：`docs/plans/2026-05-30-001-feat-boule-architecture-plan.md` §7 U0
> 结论：**5/5 退出条件全部 PASS → 可进 U1**
> Auth 路径：复用 claude CLI 登录（Keychain）跑 Agent SDK；真值源 live 拉 GitHub
> SDK：`@anthropic-ai/claude-agent-sdk@0.3.158`（Node 25 原生 type-stripping 直接跑 `.ts`）

## 退出条件判定

| # | 退出条件 | 判定 | 证据 |
|---|---|---|---|
| 1 | Agent SDK 服务端 headless 跑通真实 role | ✅ PASS | spike1：加载 `information-architect.md`（13829 chars）跑「生成 3 个 test axis」，`ok=true`，产出 4 条合规 axis |
| 2 | 必需 tools 可解析或有降级方案 | ✅ PASS | spike1：`allowedTools` 声明被接受；**Bash 工具被 agent 真实调用并返回**（`tool_use=2 / tool_result=1` live）。WebSearch 同机制可声明 |
| 3 | 并发 job 会话隔离 + usage 按 job 归账 | ✅ PASS | spike2：3 个不同 role 并发（wall 9.2s），输出互异、jobId 各归各位、Σ per-job = 总计 |
| 4 | executor 消费固化 truth snapshot | ✅ PASS | spike3：live 拉 GitHub 固化 `{commit_sha, manifest, truth_digest}`，executor 按 hash 校验读快照；上游漂移→digest 变而快照内容不变 |
| 5 | **ClaudeSDKClient → 6 类归一化事件映射成立** | ✅ PASS | spike1：6/6 类事件均有真实 SDK 来源（5 类 live + thinking_delta fixture 兜底） |

## 6 类归一化事件映射表（KTD-17 最承重假设，已证）

| 归一化事件 | live 覆盖 | SDK 来源 |
|---|---|---|
| `text_delta` | ✓ | `stream_event` → `content_block_delta.text_delta` |
| `thinking_delta` | ·（fixture 证） | `stream_event` → `content_block_delta.thinking_delta` |
| `tool_use` | ✓ | `stream_event content_block_start.tool_use` + `assistant` content block |
| `tool_result` | ✓ | `user` message `content.tool_result` |
| `usage` | ✓ | `stream_event message_delta.usage` + `result.usage` |
| `status` | ✓ | `system/init`（started） + `result`（completed/failed） |

> 映射是逐条消息纯函数（`normalize.ts`），live 流与 fixture 喂同一函数——这是 U3 `runtime-contract.test.ts` 的雏形。必须开 `includePartialMessages: true` 才有 `text_delta/thinking_delta`。

## 喂回 plan 的发现（建议进 Open Questions / U2 / U3 落实）

1. **真值源 repo 是私有的**（`ZCDeng/consulting-team`）。→ `GITHUB_TOKEN`（fine-grained 只读单仓 PAT）是**强制**，不只是防限流。raw.githubusercontent.com 私有 repo fetch 必须带 `Authorization: Bearer`（已验 HTTP 200）。锐化 KTD-20 / U2 的 token 要求。
2. **SDK 命名**：KTD-2/KTD-17 写的 `ClaudeSDKClient` 是 Python SDK 叫法；TS SDK（`@anthropic-ai/claude-agent-sdk`）实际入口是 `query()`，无 `ClaudeSDKClient` 类。6 事件经 `query({options:{includePartialMessages:true}})` 的 `stream_event` 取。建议 U3 文档统一为 `query()`。
3. **headless worker 必须有真 API key**：本次 live 用 CLI 订阅会话（`apiKeySource: none`, `model: claude-opus-4-8[1m]`）跑通；生产 BullMQ worker 无 CLI 登录，需 `ANTHROPIC_API_KEY`（`apiKeySource` 会是 `user`）。**`messages-api` fallback 的裸 key 路径本轮未验**（按 auth 决策推迟），留 U3 在有 key 时补 runtime-contract 对照。
4. **成本量级**：单 role 调用 ≈ $0.16–0.50（input 被 13.8k 字符 role system prompt 主导；spike1 cacheRead=29k 命中缓存省了一截）。7 phase × 多 role 一轮成本可观——KTD-22 的自建 cost 表从 day 1 就需要，且 prompt caching 值得在 U3 显式利用。
5. **thinking_delta live 未触发**：本轮 adaptive thinking 未以 delta 形式出现（仅 fixture 证）。U3 contract 测试应注明：`thinking_delta` 的归一化结构已证，但 live 覆盖取决于 thinking 是否开启/是否分块下发。

## 回退方案（未触发）

若 U0 失败，plan 预案 = Anthropic Messages API 直调 + 自建 prompt/tool 封装。本轮 SDK 路径全绿，**不触发回退**。`messages-api` runtime 仍按 KTD-17 作为 fallback 实现（U3），而非主路径。

## 运行方式

```bash
cd spikes && pnpm install
node u0-truth-sync/sync.ts      # spike3：真值源快照
node u0-agent-sdk/test-role.ts  # spike1：headless + 6 事件（真调 API，~$0.5）
node u0-agent-sdk/concurrency.ts # spike2：并发隔离（真调 API，~$0.6）
```

> spike1/2 真调 Agent SDK 产生费用；spike3 仅 GitHub 读取免费。
