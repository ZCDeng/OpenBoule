/**
 * API 客户端测试（U7）。401 自动刷新重试；刷新失败 onAuthLost；并发 401 单飞刷新。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiError, type Tokens } from "../src/lib/api.ts";

function res(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

function makeClient(script: (url: string, init: RequestInit | undefined, calls: string[]) => Response) {
  let tokens: Tokens | null = { accessToken: "a0", refreshToken: "r0" };
  let authLost = 0;
  const calls: string[] = [];
  const client = new ApiClient({
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push(url);
      return script(url, init, calls);
    },
    getTokens: () => tokens,
    setTokens: (t) => { tokens = t; },
    onAuthLost: () => { authLost++; },
  });
  return { client, calls, getTokens: () => tokens, getAuthLost: () => authLost };
}

test("401 → 刷新 → 重试成功，tokens 更新", async () => {
  let protectedHits = 0;
  const h = makeClient((url) => {
    if (url.includes("/auth/refresh")) return res(200, { accessToken: "a1", refreshToken: "r1" });
    protectedHits++;
    return protectedHits === 1 ? res(401, { error: "UNAUTHENTICATED" }) : res(200, { data: "ok" });
  });
  const out = await h.client.json<{ data: string }>("/api/workflows/x");
  assert.equal(out.data, "ok");
  assert.equal(h.getTokens()!.accessToken, "a1"); // 刷新后新 access
});

test("刷新失败 → onAuthLost + 抛 AUTH_LOST", async () => {
  const h = makeClient((url) => {
    if (url.includes("/auth/refresh")) return res(401, { error: "INVALID_REFRESH" });
    return res(401, { error: "UNAUTHENTICATED" });
  });
  await assert.rejects(() => h.client.json("/api/workflows/x"), (e) => e instanceof ApiError && e.code === "AUTH_LOST");
  assert.equal(h.getAuthLost(), 1);
  assert.equal(h.getTokens(), null);
});

test("并发 401 单飞刷新：只刷新一次", async () => {
  let refreshHits = 0;
  let firstTwo = 0;
  const h = makeClient((url) => {
    if (url.includes("/auth/refresh")) { refreshHits++; return res(200, { accessToken: "a1", refreshToken: "r1" }); }
    // 头两次受保护请求都 401（并发），刷新后都 200
    firstTwo++;
    return firstTwo <= 2 ? res(401, {}) : res(200, { ok: true });
  });
  await Promise.all([h.client.json("/api/a"), h.client.json("/api/b")]);
  assert.equal(refreshHits, 1); // 单飞：两路 401 只触发一次刷新
});

test("空 body POST 不带 content-type（避免 Fastify FST_ERR_CTP_EMPTY_JSON_BODY）", async () => {
  let seen: Record<string, string> | undefined;
  const h = makeClient((_url, init) => {
    seen = init?.headers as Record<string, string>;
    return res(200, { ticket: "t1" });
  });
  await h.client.json<{ ticket: string }>("/api/sse/ticket", { method: "POST" });
  assert.equal(seen?.["content-type"], undefined); // 无 body → 不声明 JSON content-type
});

test("有 body 时自动声明 JSON content-type", async () => {
  let seen: Record<string, string> | undefined;
  const h = makeClient((_url, init) => {
    seen = init?.headers as Record<string, string>;
    return res(200, { ok: true });
  });
  await h.client.json("/api/projects", { method: "POST", body: JSON.stringify({ name: "x" }) });
  assert.equal(seen?.["content-type"], "application/json");
});


test("FormData body does not get JSON content-type", async () => {
  let seen: Record<string, string> | undefined;
  const h = makeClient((_url, init) => {
    seen = init?.headers as Record<string, string>;
    return res(200, { ok: true });
  });
  const form = new FormData();
  form.append("file", new Blob(["x"]), "x.txt");
  await h.client.json("/api/projects/p/references", { method: "POST", body: form });
  assert.equal(seen?.["content-type"], undefined);
});

test("auth 端点的 401 不触发刷新（避免递归）", async () => {
  const h = makeClient(() => res(401, { error: "INVALID_CREDENTIALS" }));
  const r = await h.client.request("/api/auth/login", { method: "POST" });
  assert.equal(r.status, 401); // 直接返回，不尝试刷新
  assert.equal(h.calls.length, 1);
});
