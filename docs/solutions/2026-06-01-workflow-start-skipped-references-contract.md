---
module: api/routes/workflows
tags: [api-contract, references, mcp, workflow]
problem_type: contract-change
date: 2026-06-01
commit: fc33ac3
status: resolved
---

# Workflow 启动时跳过不可用 reference 的契约

## 问题

`POST /api/workflows` 曾把请求中的失败或不存在 reference 视为
`400 INVALID_REFERENCES`。reference 解析异步化/可失败后，这会让用户在已经上传多份材料时，
因为其中一份 OCR/解析失败而无法启动任何 workflow。

plan 002 将契约收口为：**启动 workflow 不再因单个 reference 不可用而整体失败**。
可用 reference 会被冻结进 workflow；失败或不存在的 reference 会在响应中显式列出。

## 当前契约

请求仍是：

```http
POST /api/workflows
Content-Type: application/json

{
  "projectId": "...",
  "mode": "调研",
  "referenceIds": ["ok-ref", "failed-ref", "missing-ref"]
}
```

成功响应固定为 `201`，并带上实际纳入数量与跳过列表：

```json
{
  "workflowId": "wf-...",
  "started": true,
  "referenceCount": 1,
  "skippedReferences": [
    { "id": "failed-ref", "filename": "bad.pdf", "parseStatus": "failed" },
    { "id": "missing-ref", "filename": null, "parseStatus": "missing" }
  ]
}
```

`skippedReferences` 非空表示这些 reference **没有**进入 workflow 冻结快照。调用方应展示提示，
但不应把这当作 workflow 创建失败。

仍会返回 400 的情况只包括请求形状错误，例如 `referenceIds` 不是 uuid 数组或超过数量上限。

## Agent / MCP 对齐

MCP 工具新增 `start_workflow`，直接代理 `POST /api/workflows`，并透传
`skippedReferences`。agent 通过 MCP 启动 workflow 时，必须读取该字段，避免误以为所有传入
reference 都已纳入。

当前 CLI 还没有 workflow-start 子命令，因此没有 CLI warning 面；未来如果加入，应复用同一契约：
创建成功照常退出，`skippedReferences` 非空时在 stderr 给出提示。

## 迁移提示

- 旧调用方如果依赖 `INVALID_REFERENCES` 来阻止启动，需要改为检查响应里的
  `skippedReferences.length`。
- Web 端已在非空时停留当前页并提示用户，再允许进入已创建 workflow。
- 后端冻结逻辑只接收 loaded reference；`failed` reference 进入 `freezeWorkflowReferences`
  会 fail loud，防止上游契约被静默破坏。
