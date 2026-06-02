import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../src/config.ts";
import { extractScannedWithLiteParse, parseReferenceDocument } from "../../src/services/document-parsing.ts";

// 集成测试：真跑 liteparse fork 子进程做 OCR。依赖语言包，故按前置条件 gated skip——
// 没 tessdata（CI / 全新 checkout）干净跳过；设 TESSDATA_PREFIX 指向语言包则真跑。
// 本地：TESSDATA_PREFIX="$(pwd)/apps/api/.tessdata" pnpm --filter @boule/api test
const langFile = join(config.references.tessdataPath, "eng.traineddata");
const tessReady = existsSync(langFile);
const skip = tessReady ? false : `tessdata 不可用（${langFile} 缺失）：设 TESSDATA_PREFIX 指向语言包后运行`;

const FIXTURE = new URL("../fixtures/scanned-ocr.pdf", import.meta.url);
const MARKER = "INTEGRATIONOCR7715";

test("扫描件端到端：parseReferenceDocument 走 liteparse OCR 抽出正文", { skip }, async () => {
  const buffer = readFileSync(FIXTURE);
  const result = await parseReferenceDocument({ buffer, mimeType: "application/pdf", filename: "scanned-ocr.pdf" });
  assert.equal(result.parseStatus, "parsed", `期望 parsed，实际 ${result.parseStatus}（error=${result.error}）`);
  assert.equal(result.parseSource, "liteparse");
  // 清晰英文 OCR 应命中唯一标记（容栅格噪声：去空白后包含即可）。
  assert.match(result.body.replace(/\s+/g, ""), new RegExp(MARKER));
  assert.equal(typeof result.shouldStoreOriginal, "boolean");
});

test("扫描件 OCR：confidence 落在 0..1 且达标（回归——锁死标度，防再现 /100 误修复）", { skip }, async () => {
  const buffer = readFileSync(FIXTURE);
  const ocr = await extractScannedWithLiteParse({ buffer, mimeType: "application/pdf", filename: "scanned-ocr.pdf" });
  assert.equal(ocr.error, undefined);
  assert.ok(ocr.confidence !== null, "应有 confidence 样本");
  assert.ok(ocr.confidence > 0 && ocr.confidence <= 1, `confidence 应在 0..1，实际 ${ocr.confidence}`);
  // 清晰英文必然高于默认门 0.55；若回到 0–100 标度这里会变成 ~95 而断言失败。
  assert.ok(ocr.confidence >= config.references.ocrConfidenceThreshold, `清晰扫描件应过门，实际 ${ocr.confidence}`);
});
