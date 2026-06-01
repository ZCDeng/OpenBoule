import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { postFile, CliError } from "../src/client.ts";

const cfg = { daemonUrl: "http://test", apiKey: "bk_test" };

test("postFile sends multipart without JSON content-type", async () => {
  const dir = mkdtempSync(join(tmpdir(), "boule-cli-"));
  const file = join(dir, "brief.txt");
  writeFileSync(file, "hello");
  const oldFetch = globalThis.fetch;
  let seen: RequestInit | undefined;
  globalThis.fetch = (async (_input, init) => {
    seen = init;
    return new Response(JSON.stringify({ reference: { id: "r1", parseStatus: "parsed" } }), { status: 201 });
  }) as typeof fetch;
  try {
    const out = await postFile(cfg, "/api/projects/p1/references", file) as { reference: { id: string } };
    assert.equal(out.reference.id, "r1");
    const headers = seen!.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer bk_test");
    assert.equal(headers["content-type"], undefined);
    assert.ok(seen!.body instanceof FormData);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("postFile missing path fails before fetch", async () => {
  const oldFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error("should not call"); }) as typeof fetch;
  try {
    await assert.rejects(() => postFile(cfg, "/api/projects/p1/references", "/no/such/file"), (err) => err instanceof CliError && /读取 reference 文件失败/.test(err.message));
    assert.equal(called, false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
