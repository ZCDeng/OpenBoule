/**
 * MCP 资源（U1 / KTD-2）。只读 URI，thin fetch → Boule API。
 *
 * 落地范围（fail loud）：`boule://axes/{workflowId}` 映射到真实端点（GET /api/workflows/:id → axes）。
 * plan 还列了 `boule://skills/{id}` 与 `boule://methods/{id}`——二者需公开暴露真值源快照内容，
 * 当前无对应端点，挂 Deferred（需先定「是否/如何公开 role prompt 与方法论正文」）。
 */

import type { BouleClient } from "./tools.ts";

export interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: () => Promise<string>;
}

const AXES_PREFIX = "boule://axes/";

/** 动态解析 axes 资源 URI（boule://axes/{workflowId}）。非 axes URI 返回 null。 */
export async function readResource(client: BouleClient, uri: string): Promise<string | null> {
  if (!uri.startsWith(AXES_PREFIX)) return null;
  const workflowId = uri.slice(AXES_PREFIX.length).replace(/\/.*$/, "");
  if (!workflowId) return null;
  const res = await client.fetchImpl(`${client.baseUrl}/api/workflows/${workflowId}`, {
    headers: { authorization: `Bearer ${client.apiKey}` },
  });
  if (!res.ok) throw new Error(`读取 axes 资源失败：HTTP ${res.status}`);
  const wf = (await res.json()) as { axes?: unknown };
  return JSON.stringify(wf.axes ?? null, null, 2);
}

/** 列出可枚举的静态资源（axes 是按 workflow 动态的，故不在静态列表，靠模板读）。 */
export function listResources(): ResourceDef[] {
  return [];
}

/** 资源模板（让 client 知道 boule://axes/{workflowId} 这种动态 URI 可读）。 */
export function resourceTemplates(): { uriTemplate: string; name: string; description: string; mimeType: string }[] {
  return [
    {
      uriTemplate: "boule://axes/{workflowId}",
      name: "workflow-axes",
      description: "某 workflow 的调研轴（phase1.5 分解结果），JSON。",
      mimeType: "application/json",
    },
  ];
}
