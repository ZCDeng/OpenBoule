#!/usr/bin/env node
// OCR 阈值校准脚本（code-review #2）。
//
// 用途：BOULE_OCR_CONFIDENCE_THRESHOLD 当前默认 0.55 是拍脑袋值，从未用真实 Tesseract 输出验证过。
// 本脚本拿真实中文扫描件跑 liteparse OCR，打印每份文档的 confidence（原生 0–100 与归一 0..1）、
// 文本量与预览，并给出阈值建议。给了 good/bad 标签时，计算一个能分开两类的阈值。
//
// 用法：
//   node apps/api/scripts/ocr-calibrate.mjs <pdf目录> [labels.json]
//
//   labels.json（可选）：{ "扫描件A.pdf": "good", "糊掉的B.pdf": "bad", ... }
//   good = 人工确认 OCR 出来的文本可用；bad = 糊/错/不可用。
//
// tessdata：若 TESSDATA_PREFIX 指向的目录缺语言包，脚本会按 Dockerfile 锁定的 commit + sha256
// 下载 chi_sim/eng 到 apps/api/.tessdata（一次性，已存在则跳过）。
//
// 注意：归一口径（/100）与 document-ocr.child.ts 的 averageConfidence 一致，所以打印出来的
// “归一”列可直接当作 BOULE_OCR_CONFIDENCE_THRESHOLD 候选值。

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { LiteParse } from "@llamaindex/liteparse";

// 与 apps/api/Dockerfile 保持一致（升级时三处同步：Dockerfile、docs/solutions、这里）。
const TESSDATA_COMMIT = "87416418657359cb625c412a48b6e1d6d41c29bd";
const TESSDATA = {
  "chi_sim.traineddata": "a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730",
  "eng.traineddata": "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
};

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function ensureTessdata() {
  const envPath = process.env.TESSDATA_PREFIX;
  if (envPath && Object.keys(TESSDATA).every((f) => existsSync(join(envPath, f)))) return envPath;

  const local = resolve(import.meta.dirname, "..", ".tessdata");
  mkdirSync(local, { recursive: true });
  for (const [file, want] of Object.entries(TESSDATA)) {
    const dest = join(local, file);
    if (existsSync(dest) && sha256(readFileSync(dest)) === want) continue;
    const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${TESSDATA_COMMIT}/${file}`;
    process.stderr.write(`下载 ${file} …\n`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载 ${file} 失败：HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== want) throw new Error(`${file} sha256 不匹配：want ${want} got ${got}`);
    writeFileSync(dest, buf);
  }
  return local;
}

// 与 document-ocr.child.ts averageConfidence 同口径：liteparse item.confidence 实测已是 0..1，直接取均值。
function meanConfidence(result) {
  let total = 0;
  let samples = 0;
  for (const page of result.pages) {
    for (const item of page.textItems) {
      if (typeof item.confidence === "number" && Number.isFinite(item.confidence)) {
        total += item.confidence;
        samples += 1;
      }
    }
  }
  return { conf: samples ? total / samples : null, samples };
}

async function main() {
  const dir = process.argv[2];
  const labelsPath = process.argv[3];
  if (!dir) {
    process.stderr.write("用法：node apps/api/scripts/ocr-calibrate.mjs <pdf目录> [labels.json]\n");
    process.exit(2);
  }
  const labels = labelsPath ? JSON.parse(readFileSync(labelsPath, "utf8")) : {};
  const tessdataPath = await ensureTessdata();
  process.stderr.write(`tessdata: ${tessdataPath}\n`);

  const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  if (!pdfs.length) {
    process.stderr.write(`目录无 PDF：${dir}\n`);
    process.exit(2);
  }

  const rows = [];
  for (const file of pdfs) {
    const buf = readFileSync(join(dir, file));
    const parser = new LiteParse({
      ocrEnabled: true,
      ocrLanguage: process.env.BOULE_OCR_LANGUAGE ?? "chi_sim+eng",
      tessdataPath,
      maxPages: Number(process.env.BOULE_OCR_MAX_PAGES ?? 100),
      dpi: Number(process.env.BOULE_OCR_DPI ?? 200),
      outputFormat: "json",
      quiet: true,
      numWorkers: 1,
    });
    let row;
    try {
      const t0 = process.hrtime.bigint();
      const result = await parser.parse(Buffer.from(buf));
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const c = meanConfidence(result);
      const text = (result.text ?? "").trim();
      row = { file, ok: true, conf: c.conf, samples: c.samples, chars: text.length, ms,
        label: labels[file] ?? "", preview: text.replace(/\s+/g, " ").slice(0, 60) };
    } catch (err) {
      row = { file, ok: false, error: err instanceof Error ? err.message : String(err), label: labels[file] ?? "" };
    }
    rows.push(row);
    process.stderr.write(`✓ ${file}\n`);
  }

  // 表格（conf 为 0..1，可直接对照 BOULE_OCR_CONFIDENCE_THRESHOLD）
  console.log("\n| 文件 | conf(0..1) | samples | 字符 | ms | 标签 | 预览 |");
  console.log("|------|-----------|---------|------|----|------|------|");
  for (const r of rows) {
    if (!r.ok) { console.log(`| ${r.file} | ERROR | | | | ${r.label} | ${r.error} |`); continue; }
    const conf = r.conf === null ? "null" : r.conf.toFixed(3);
    console.log(`| ${r.file} | ${conf} | ${r.samples} | ${r.chars} | ${r.ms.toFixed(0)} | ${r.label} | ${r.preview} |`);
  }

  // 阈值建议
  const good = rows.filter((r) => r.ok && r.conf !== null && r.label === "good").map((r) => r.conf);
  const bad = rows.filter((r) => r.ok && r.conf !== null && r.label === "bad").map((r) => r.conf);
  console.log("\n— 阈值建议 —");
  if (good.length && bad.length) {
    const minGood = Math.min(...good);
    const maxBad = Math.max(...bad);
    if (minGood > maxBad) {
      const mid = (minGood + maxBad) / 2;
      console.log(`good 最低 ${minGood.toFixed(3)} > bad 最高 ${maxBad.toFixed(3)} → 可分。建议阈值 ≈ ${mid.toFixed(3)}（取中点）。`);
    } else {
      console.log(`good 最低 ${minGood.toFixed(3)} ≤ bad 最高 ${maxBad.toFixed(3)} → confidence 无法干净分开 good/bad。`);
      console.log("说明 confidence 不是可靠的质量信号，需换判据（如关键词命中率/CER）或保留 Claude 兜底。");
    }
  } else {
    const norms = rows.filter((r) => r.ok && r.conf !== null).map((r) => r.conf).sort((a, b) => a - b);
    if (norms.length) {
      const p = (q) => norms[Math.min(norms.length - 1, Math.floor(q * norms.length))];
      console.log(`未提供 good/bad 标签。confidence(0..1) 分布：min ${norms[0].toFixed(3)} / p25 ${p(0.25).toFixed(3)} / 中位 ${p(0.5).toFixed(3)} / p75 ${p(0.75).toFixed(3)} / max ${norms[norms.length - 1].toFixed(3)}`);
      console.log("给文件打 good/bad 标签（labels.json）再跑一次，可得到可分阈值建议。");
    }
    console.log(`当前默认 BOULE_OCR_CONFIDENCE_THRESHOLD=0.55。对照上面分布判断 0.55 是否合理。`);
  }
}

main().catch((err) => { process.stderr.write(`${err?.stack ?? err}\n`); process.exit(1); });
