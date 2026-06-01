import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../src/index.ts";
import { CliError } from "../src/client.ts";

interface SeenCall {
  url: string;
  method: string;
  auth: string | undefined;
  contentType: string | undefined;
  body: unknown;
}

async function withMockedFetch<T>(fn: (calls: SeenCall[]) => Promise<T>): Promise<T> {
  const oldFetch = globalThis.fetch;
  const oldWrite = process.stdout.write;
  const calls: SeenCall[] = [];
  globalThis.fetch = (async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      auth: headers.authorization,
      contentType: headers["content-type"],
      body: init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = oldFetch;
    process.stdout.write = oldWrite;
  }
}

const cfgArgs = ["--daemon-url", "http://test", "--api-key", "bk_test"];

test("references list routes to GET project references", async () => {
  await withMockedFetch(async (calls) => {
    const code = await run(["references", "list", "--project", "p1", ...cfgArgs]);
    assert.equal(code, 0);
    assert.equal(calls[0]!.method, "GET");
    assert.equal(calls[0]!.url, "http://test/api/projects/p1/references");
    assert.equal(calls[0]!.auth, "Bearer bk_test");
  });
});

test("references upload routes to multipart postFile", async () => {
  const dir = mkdtempSync(join(tmpdir(), "boule-cli-route-"));
  const file = join(dir, "brief.txt");
  writeFileSync(file, "hello");
  await withMockedFetch(async (calls) => {
    const code = await run(["references", "upload", "--project", "p1", "--file", file, ...cfgArgs]);
    assert.equal(code, 0);
    assert.equal(calls[0]!.method, "POST");
    assert.equal(calls[0]!.url, "http://test/api/projects/p1/references");
    assert.equal(calls[0]!.contentType, undefined);
    assert.ok(calls[0]!.body instanceof FormData);
  });
});

test("references delete routes to DELETE project reference", async () => {
  await withMockedFetch(async (calls) => {
    const code = await run(["references", "delete", "--project", "p1", "--id", "r1", ...cfgArgs]);
    assert.equal(code, 0);
    assert.equal(calls[0]!.method, "DELETE");
    assert.equal(calls[0]!.url, "http://test/api/projects/p1/references/r1");
  });
});

test("references upload/delete/list missing flags and unknown subcommand throw CliError", async () => {
  await withMockedFetch(async () => {
    await assert.rejects(() => run(["references", "list", ...cfgArgs]), (err) => err instanceof CliError && /--project/.test(err.message));
    await assert.rejects(() => run(["references", "upload", "--project", "p1", ...cfgArgs]), (err) => err instanceof CliError && /--file/.test(err.message));
    await assert.rejects(() => run(["references", "delete", "--project", "p1", ...cfgArgs]), (err) => err instanceof CliError && /--id/.test(err.message));
    await assert.rejects(() => run(["references", "wat", "--project", "p1", ...cfgArgs]), (err) => err instanceof CliError && /list\|upload\|delete/.test(err.message));
  });
});
