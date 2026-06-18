# PGlite 兼容性 spike 结论（2026-06-18）

目的：决定「PGlite + 进程内队列」数据层方案是否成立。结论——**成立，且 SQL 层几乎零改动**。

## 实测结果

PGlite（`@electric-sql/pglite`，最新）在 Node 25 内存实例上实测，覆盖后端全部高风险 PG 特性：

| 特性 | 用处 | 结果 |
|---|---|---|
| `gen_random_uuid()` | 主键默认 | ✅ |
| `make_interval(secs=>n)` | checkpoint.ts 租约计算 | ✅（此前判为不支持，错）|
| `pg_advisory_xact_lock` / `pg_advisory_lock` / `hashtext` | references.ts 项目级互斥 | ✅（#2 阻塞消失）|
| `bigserial` 序列 + RETURNING | workflow_events.event_id 单调 ID | ✅ |
| `jsonb_set` / `coalesce` / `-` 去键 / `@>` | approvals.ts、surface-cache | ✅ |
| `xmax = 0 AS inserted` 系统列 | references.ts 区分 insert/update | ✅ |
| ENUM + `ALTER TYPE ADD VALUE IF NOT EXISTS` | 9 个枚举 + 增量迁移 | ✅ |
| CTE + window function | 通用 | ✅ |
| `SELECT … FOR UPDATE`（事务内）| 行级锁退路 | ✅ |
| `ON CONFLICT … DO UPDATE RETURNING` | 幂等写 | ✅ |

## 唯一注意点

PGlite 单次 `query()` 不能塞多语句（`BEGIN; …; COMMIT;` 报 *cannot insert multiple commands into a prepared statement*）。
→ 多语句必须走 `db.exec(sql)` 或事务 API。Drizzle 用自己的 `transaction()`，不受影响；只需排查代码里手写的多语句字符串。

## 驱动可用性

`drizzle-orm/pglite` 适配器在仓库现装的 drizzle-orm 0.38.4 里现成（`node_modules/.../drizzle-orm/pglite/driver.js`）。
`db client.ts` 从 `drizzle(node-postgres pool)` 换到 `drizzle(pglite)` 直接可行。

## 对计划的影响

- 数据层不再是「18–26 天高风险」。SQL 几乎不动，真正工作量收窄为：
  1. db client 驱动替换（小）；
  2. **进程内队列复刻 BullMQ parent-child fan-out**（中，是数据层主要工作量，但单进程免去分布式恢复）；
  3. Redis 小工具内存化（ticket/doc-lock/撤销集/限流/active-context，逐个低风险）。
- 复现脚本：`spikes/pglite-compat/test.mjs`、`test2.mjs`。
