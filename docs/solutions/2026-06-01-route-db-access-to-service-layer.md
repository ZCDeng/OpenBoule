---
module: api/routes/references
tags: [refactor, layering, drizzle, conformance]
problem_type: convention-drift
date: 2026-06-01
commit: 3d4f43e
status: resolved
---

# 路由内联 SQL 下沉到 service 层

## 问题

`DELETE /api/projects/:id/references/:referenceId` 在路由 handler 里直接写
`db.execute(sql\`DELETE ...\`)`,而同文件的 GET/POST 都走 `services/references.ts`。
单文件内两套数据访问风格并存,违反 codebase conformance——读代码时要在"路由直连 DB"
和"路由调 service"两种心智模型间来回切。

代码审核(commit `9fffd3c`)时标为非阻塞观察,本次单独清理。

## 解决

把删除逻辑抽成 service 函数,路由只剩鉴权 + HTTP 状态码映射。

```ts
// services/references.ts —— 与 create/list 同风格,参数化 SQL,返回是否删到行
export async function deleteProjectReference(db: DB, projectId: string, referenceId: string): Promise<boolean> {
  const res = await db.execute(sql`
    DELETE FROM project_references WHERE project_id = ${projectId} AND id = ${referenceId}`);
  return ((res as unknown as { rowCount?: number }).rowCount ?? 0) > 0;
}
```

```ts
// routes/references.ts —— handler 只判 boolean → 404/204,并移除不再用的 sql import
const deleted = await deleteProjectReference(db, projectId, referenceId);
if (!deleted) return reply.code(404).send({ error: "NOT_FOUND" });
return reply.code(204).send();
```

行为等价:鉴权(`requireProjectRole owner`)、参数化、状态码全部不变。

## 原则

- **路由层不直接碰 DB**。handler 负责鉴权 + 请求/响应映射;所有 SQL 收在 service。
  下次在路由里看到 `db.execute(sql\`...\`)`,先问该不该下沉。
- 删除类 service 返回 `boolean`(是否影响行),把 404 判断留给调用方,而不是
  让 service 抛错或回 rowCount。
- 抽函数后顺手清死 import(本次的 `sql`),否则 typecheck 过但留垃圾。

## 验证

API typecheck ✅ · 184 tests pass ✅。无新增测试——纯结构重构,行为未变,
既有路由测试即覆盖意图(对应纪律「测试测意图」)。
