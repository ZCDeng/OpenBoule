/**
 * U1 MCP 工具单测（注入 fetch，无网络）。验证 thin proxy：路径/方法/Bearer、active context 回退、
 * daemon 不可达清晰错误。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createBouleClient, makeTools } from "../../src/mcp/tools.ts";

interface Recorded {
  url: string;
  method: string;
  auth: string | undefined;
  body: unknown;
}

/** 造一个记录调用并按 url 返回 canned JSON 的 fetch。 */
function fakeFetch(routes: Record<string, unknown>, rec: Recorded[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    rec.push({
      url,
      method: init?.method ?? "GET",
      auth: headers.authorization,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const path = url.replace("http://test", "");
    const match = Object.keys(routes).find((k) => path === k);
    const payload = match ? routes[match] : { error: "NOT_FOUND" };
    return new Response(JSON.stringify(payload), {
      status: match ? 200 : 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function client(routes: Record<string, unknown>, rec: Recorded[]) {
  return createBouleClient({ baseUrl: "http://test", apiKey: "bk_test", fetchImpl: fakeFetch(routes, rec) });
}

test("工具集恰好 7 个，命名稳定", () => {
  const tools = makeTools(client({}, []));
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "get_active_context",
    "get_documents",
    "get_workflow",
    "list_axes",
    "list_projects",
    "search_research",
    "submit_artifact",
  ]);
});

test("list_projects → GET /api/projects 带 Bearer", async () => {
  const rec: Recorded[] = [];
  const tools = makeTools(client({ "/api/projects": { projects: [{ id: "p1" }] } }, rec));
  const out = (await tools.find((t) => t.name === "list_projects")!.handler({})) as { projects: unknown[] };
  assert.equal(out.projects.length, 1);
  assert.equal(rec[0]!.url, "http://test/api/projects");
  assert.equal(rec[0]!.auth, "Bearer bk_test");
});

test("get_workflow 不传 workflow → 回退 active context", async () => {
  const rec: Recorded[] = [];
  const tools = makeTools(
    client(
      {
        "/api/active-context": { activeContext: { workflowId: "wf-ac" } },
        "/api/workflows/wf-ac": { id: "wf-ac", status: "running" },
      },
      rec,
    ),
  );
  const out = (await tools.find((t) => t.name === "get_workflow")!.handler({})) as { id: string };
  assert.equal(out.id, "wf-ac");
  assert.ok(rec.some((r) => r.url.endsWith("/api/active-context")), "先查 active context");
  assert.ok(rec.some((r) => r.url.endsWith("/api/workflows/wf-ac")), "再查命中的 workflow");
});

test("get_workflow 无显式且无 active context → 清晰错误", async () => {
  const tools = makeTools(client({ "/api/active-context": { activeContext: {} } }, []));
  await assert.rejects(
    () => tools.find((t) => t.name === "get_workflow")!.handler({}),
    /未指定 workflow.*active context/,
  );
});

test("submit_artifact → POST 正确路径与 body", async () => {
  const rec: Recorded[] = [];
  const tools = makeTools(
    client({ "/api/workflows/wf-1/artifacts": { artifactId: "a1", status: "draft" } }, rec),
  );
  const out = (await tools.find((t) => t.name === "submit_artifact")!.handler({
    workflow: "wf-1",
    type: "research",
    body: "结论…",
  })) as { artifactId: string };
  assert.equal(out.artifactId, "a1");
  const call = rec.find((r) => r.method === "POST")!;
  assert.equal(call.url, "http://test/api/workflows/wf-1/artifacts");
  // phase 未传 → JSON.stringify 丢弃 undefined 键，body 不含 phase。
  assert.deepEqual(call.body, { type: "research", body: "结论…" });
});

test("daemon 不可达 → 清晰错误（含 baseUrl）", async () => {
  const failing = createBouleClient({
    baseUrl: "http://test",
    apiKey: "bk_test",
    fetchImpl: (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch,
  });
  const tools = makeTools(failing);
  await assert.rejects(
    () => tools.find((t) => t.name === "list_projects")!.handler({}),
    /无法连接 Boule API（http:\/\/test）.*daemon/,
  );
});
