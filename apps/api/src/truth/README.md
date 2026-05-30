# truth/ — 真值源同步（U2，R6）

把 GitHub 上 `consulting-team/skills/` 作为 Boule 行为的**唯一真值源**：改 `roles/*.md` / `SKILL.md` 即改变 Boule 行为。本模块负责拉取、缓存、固化快照、digest、drift 检测。

## 不变式（违反即破坏 R6）

1. **快照 immutable**：`workflows.truth_snapshot` 一旦写入绝不修改。所有 phase / retry / redo 只读它 → "改 skill 只影响新 workflow"。
2. **写入收口**：`workflows.truth_snapshot` 的值只由 `sync.ts#createFrozenSnapshot()` 生产。任何其它代码不得自行构造 snapshot。CI 守卫：`tests/truth/write-funnel.guard.test.ts`。
3. **digest 算法 FROZEN**：`digest.ts#computeTruthDigest` 带 `DIGEST_VERSION`。改算法必须 bump version + 更新 `tests/truth/digest.test.ts` frozen fixture，否则历史快照静默漂移（同源误判异源）。
4. **stale 不重写内容**：drift 只产出"上游已变"信号，绝不回写在途 workflow 的快照。

## 模块

| 文件 | 职责 |
|---|---|
| `digest.ts` | `canonicalJSON` + `computeTruthDigest`（frozen 聚合锚点）|
| `sync.ts` | GitHub 拉取（raw + Bearer，私有 repo token 强制）、本地缓存、降级、`createFrozenSnapshot`（唯一生产者）、`syncTruthSource`、`validateGithubToken`（启动 dry-run）|
| `loader.ts` | 从快照读 role prompt（hash 校验）、列 role、解析 augment-map |
| `drift.ts` | 重算 HEAD digest 比对在用快照，产 `DriftReport`（不碰 DB，digest 列表由调用方传入）|
| `types.ts` | `TruthSnapshot` / `ManifestEntry` / `SyncResult` / `DriftReport` / `AugmentMap` |

## 边界（下游 IU）

- **HTTP 端点** `POST /api/admin/sync-truth-source` 在 **U6** 包装 `syncTruthSource()`。
- **写 `workflows.truth_snapshot`** 的 INSERT 在 **U4**（创建 workflow 时调 `createFrozenSnapshot()` 取值）。
- **drift 的周期调度 + DB digest 查询**在 **U4/U6**（本模块只提供纯检测函数）。
- **snapshot-diff（字段级变更报告）** 已推迟（Scope Boundaries Deferred）——drift 的 stale 标记已满足 R6 可观测。
- **token** 走环境密钥（`GITHUB_TOKEN`），不入库；私有 repo 下 token 强制（非仅防限流）。
