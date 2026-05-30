/**
 * 资源内联防护测试（U10）。SSRF / 路径穿越 / OOM 上限 —— 真临时目录。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inlineAssets, validateAssetPath, isPrivateHost } from "../../src/share/inline-assets.ts";

const base = mkdtempSync(join(tmpdir(), "boule-inline-"));
const outside = mkdtempSync(join(tmpdir(), "boule-secret-"));
writeFileSync(join(base, "style.css"), "body{color:red}");
writeFileSync(join(base, "big.css"), "x".repeat(2000));
writeFileSync(join(outside, "secret.css"), "STOLEN");
mkdirSync(join(base, "sub"), { recursive: true });

after(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("内联顶层相对 <link>", () => {
  const r = inlineAssets(`<link rel="stylesheet" href="style.css">`, base);
  assert.match(r.html, /<style>body\{color:red\}<\/style>/);
  assert.deepEqual(r.inlined, ["style.css"]);
});

test("路径穿越：../ 逃出 baseDir → 跳过不内联", () => {
  // base 与 outside 是 tmpdir 下兄弟目录；../<outside名>/secret.css 上跳一级再进 outside
  const href = `../${outside.split("/").pop()!}/secret.css`;
  const r = inlineAssets(`<link rel="stylesheet" href="${href}">`, base);
  assert.ok(!r.html.includes("STOLEN")); // 没读到外部文件
  assert.equal(r.inlined.length, 0);
  assert.ok(r.skipped.some((s) => /穿越/.test(s.reason)), JSON.stringify(r.skipped));
});

test("file:// / 远程 scheme → 不内联", () => {
  assert.equal(validateAssetPath("file:///etc/passwd", base).ok, false);
  assert.equal(validateAssetPath("http://example.com/a.css", base).ok, false);
  assert.equal(validateAssetPath("//evil.com/a.css", base).ok, false);
});

test("OOM：超单 asset 上限 → 跳过", () => {
  const r = inlineAssets(`<link rel="stylesheet" href="big.css">`, base, { perAssetBytes: 100, totalBytes: 1e6 });
  assert.equal(r.inlined.length, 0);
  assert.ok(r.skipped.some((s) => /上限/.test(s.reason)));
});

test("isPrivateHost：loopback/私网/link-local/metadata 全判私网", () => {
  for (const h of ["localhost", "127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "::1"]) {
    assert.equal(isPrivateHost(h), true, h);
  }
  assert.equal(isPrivateHost("example.com"), false);
  assert.equal(isPrivateHost("8.8.8.8"), false);
});
