---
title: "refactor: authenticate 去 singletonDb 耦合 — db 注入对齐 requireProjectRole"
status: draft
date: 2026-05-31
type: refactor
depth: minimal
related: docs/plans/2026-05-31-002-feat-web-cli-bridge-plan.md
---

# refactor: authenticate 去 singletonDb 耦合

## Summary

`authenticate` 中间件为支持 API-key 路径，直接 `import { db as singletonDb }` 做 hash 查询。
这是 U1（PR #2）code-review 的 deferred 项 **#5**：中间件耦合进程级 db 单例，与全代码库「db 经注入流动」
的约定（`requireProjectRole(db, …)`、`buildApp({db})`、所有路由用 `deps.db`）不一致。

今日**功能安全**——测试 `_helpers.ts` 把同一个单例 `db` 既注入 `buildApp` 又被 `authenticate` import，
两者指向同一实例。但这是**隐性巧合**：任何未来用不同 db 实例注入 `buildApp` 的测试，会静默地让
`authenticate` 的 API-key 校验打到**错误的库**，且无报错——这正是 maintainability reviewer 标的 latent trap。

本 plan 把 `authenticate` 的 db 来源从 import 单例改为注入，消除耦合。**纯重构，零行为变更。**

## Problem Frame

- `middleware/auth.ts:13` `import { db as singletonDb }`；`:62` `verifyApiKey(singletonDb, token)`。
- `authenticate` 被 **16 处**以裸 `preHandler: authenticate` 形式引用，跨 **11 个文件**
  （routes/{auth,api-keys,active-context,projects,workflows,approvals,artifacts,surfaces,locks,sse}.ts + share/routes.ts）。
- 对比：`requireProjectRole(db, minRole, resolve)` 是工厂，db 显式传入——这是既有正确范式。
- 既有设计倾向：app.ts 注释「避免全局 module augmentation 的脆弱性」（指 req.user 不用 Fastify decorate）。
  → 团队偏好**显式工厂**而非 server 装饰，方案选型据此。

## Key Technical Decisions

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| KTD-1 | db 注入方式 | **工厂 `makeAuthenticate(db)`** | 对齐 `requireProjectRole(db,…)` 既有范式 + 团队回避 decorate 的明示倾向。Alternative B（`app.decorate("db")` + `req.server.db`）churn 更小（0 路由改动）但与既有 req.user 设计哲学相悖，列为备选不采纳 |
| KTD-2 | 向后兼容 | **保留 `authenticate` 名导出做 thin 包装** 或**全量替换** | 全量替换更干净（无双路径），但改 16 处。选全量替换——一次到位，不留「裸 authenticate 仍打单例」的混淆面 |
| KTD-3 | 无 db 的中间件 | **`rejectApiKeyAuth` / `rejectScopedApiKey` / `localModeHook` 不动** | 它们只读 `getUser(req)`，不碰 db，无耦合问题 |

## Implementation Units

### U1. authenticate 工厂化 + 16 调用点迁移

**Goal**：`authenticate` 从 import 单例改为 `makeAuthenticate(db)` 工厂，db 经注入流入。
**Requirements**：消除 singletonDb import；零行为变更；全套测试不改语义即绿。
**Dependencies**：无（纯内部重构）。

**Files**：
- `apps/api/src/middleware/auth.ts`（改）：
  - 删 `import { db as singletonDb }`
  - `export function makeAuthenticate(db: DB) { return async (req, reply) => { …现 authenticate 体，verifyApiKey(db, token)… } }`
  - 保留 `setUser/getUser/extractToken/isApiKeyToken` 等不变
- 11 个路由/share 文件（改）：每个在 `register*Routes(app, deps)` 顶部 `const authenticate = makeAuthenticate(deps.db);`
  然后**局部变量遮蔽**——下方 16 处 `preHandler: authenticate` / `[authenticate, …]` / `webOnly = [authenticate, …]`
  无需逐个改（变量名复用，闭包捕获注入的 db）。这是最小改动点：每文件加一行，调用点不动。

**Approach**：
1. `makeAuthenticate(db)` 包住现有 `authenticate` 函数体（逻辑逐字搬，只把 `singletonDb` 换成闭包 `db`）。
2. 每个 `register*Routes` 顶部加 `const authenticate = makeAuthenticate(deps.db);`——局部 const 遮蔽原 import，
   16 个调用点零改动。
3. 删 `auth.ts` 里旧的 `export async function authenticate` 与 `singletonDb` import。
4. 编译器兜底：删除导出后，任何漏迁移的文件 `authenticate` 未定义 → tsc 报错（fail loud，不会静默打单例）。

**Test scenarios**（全部已有，验证语义不变）：
- 全套 api 180 测保持绿（尤其 `tests/mcp/api-keys.test.ts` 的 bk_ key 认证、撤销→401、scope 拒写——
  这些经 `app.inject` 走注入的 db，迁移后必须仍命中同一库）。
- **新增 1 测**（闭合 latent trap）：用**独立第二个 db 实例**（或 spy 包装）注入 `buildApp`，
  断言 API-key 校验打到注入的实例而非进程单例——这是 #5 的根因回归，证明解耦真实生效。

**Verification**：
- `grep singletonDb apps/api/src` 为空。
- `grep -c 'makeAuthenticate(deps.db)' ` == 11（每路由文件一处）。
- api 180 + 新 1 = 181 绿，tsc 0。

## Scope Boundaries

### In Scope
- `authenticate` 工厂化 + 11 文件各加一行 + 删单例 import。
- 1 个根因回归测试（注入独立 db 实例验证）。

### Deferred / 不做
- `requireProjectRole` 已是工厂，不动。
- `rejectApiKeyAuth/rejectScopedApiKey/localModeHook` 无 db 耦合，不动。
- 不引入 Fastify `app.decorate`（KTD-1 备选 B，不采纳）。
- 不动任何路由的鉴权语义 / 状态码 / RBAC。

## Risks

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 漏迁移某文件 → 该文件 `authenticate` 未定义 | 低 | tsc 编译即报错（删 export 后），fail loud 不静默 |
| 局部 const 遮蔽 import 造成混淆 | 低 | 删除 auth.ts 的 `authenticate` 导出后不存在「裸 import」，只剩工厂——无双路径 |
| 回归测试本身用错 db 实例 | 低 | 新测显式断言「注入实例被调用、单例未被调用」 |

## Sources

- PR #2 code-review（2026-05-31，8-persona）maintainability finding #5：`authenticate() bypasses injected db — imports singleton directly`。
- 既有范式：`apps/api/src/middleware/auth.ts` `requireProjectRole(db, …)`；`apps/api/src/app.ts` 组合根注释。
