import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config.ts";
import { decideLiteParseOcr, parseReferenceDocument, parseVmRssKb, Semaphore } from "../../src/services/document-parsing.ts";

function escapePdfText(text: string): string {
  return text.replace(/[()\\]/g, "\\$&");
}

function pdfWithText(text: string): Buffer {
  const content = `BT /F1 12 Tf 50 750 Td (${escapePdfText(text)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(out);
}

test("digital PDF keeps pdfjs local-js path and does not require OCR", async () => {
  const marker = "Boule digital PDF marker ";
  const result = await parseReferenceDocument({
    buffer: pdfWithText(marker.repeat(12)),
    mimeType: "application/pdf",
    filename: "digital.pdf",
  });
  assert.equal(result.parseStatus, "parsed");
  assert.equal(result.parseSource, "local-js");
  assert.equal(result.shouldStoreOriginal, false);
  assert.match(result.body, /Boule digital PDF marker/);
});

test("liteparse OCR decision fails loud for empty, missing, and low confidence", () => {
  assert.deepEqual(decideLiteParseOcr({ text: "", confidence: 0.99, pages: 1, confidenceSamples: 2 }), {
    ok: false,
    shouldStoreOriginal: true,
    error: "LITEPARSE_EMPTY_TEXT",
  });
  assert.deepEqual(decideLiteParseOcr({ text: "正文", confidence: null, pages: 1, confidenceSamples: 0 }), {
    ok: false,
    shouldStoreOriginal: true,
    error: "LITEPARSE_CONFIDENCE_UNAVAILABLE",
  });
  const low = decideLiteParseOcr({ text: "正文", confidence: Math.max(0, config.references.ocrConfidenceThreshold / 2), pages: 1, confidenceSamples: 4 });
  assert.equal(low.ok, false);
  assert.equal(low.shouldStoreOriginal, true);
  assert.match(low.error ?? "", /^LITEPARSE_LOW_CONFIDENCE_/);
});

test("Semaphore caps concurrency and hands slots to waiters FIFO", async () => {
  const sem = new Semaphore(1);
  const order: number[] = [];
  await sem.acquire(); // slot 1 taken
  let secondAcquired = false;
  const second = sem.acquire().then(() => { secondAcquired = true; order.push(2); });
  // 第二个 acquire 必须等待，不能在 release 前完成
  await Promise.resolve();
  assert.equal(secondAcquired, false);
  order.push(1);
  sem.release(); // 交棒给排队的第二个
  await second;
  assert.deepEqual(order, [1, 2]);
  sem.release();
});

test("parseVmRssKb extracts VmRSS from /proc status, null otherwise", () => {
  const status = "Name:\tnode\nVmPeak:\t  900000 kB\nVmRSS:\t  524288 kB\nThreads:\t11\n";
  assert.equal(parseVmRssKb(status), 524288);
  assert.equal(parseVmRssKb("VmHWM:\t 1000 kB\n"), null);
  assert.equal(parseVmRssKb(""), null);
});

test("liteparse OCR decision wraps child error field", () => {
  assert.deepEqual(decideLiteParseOcr({ text: "正文", confidence: 0.9, pages: 1, confidenceSamples: 2, error: "SIGKILL" }), {
    ok: false,
    shouldStoreOriginal: true,
    error: "LITEPARSE_OCR_FAILED: SIGKILL",
  });
});

test("liteparse OCR decision binds shouldStoreOriginal to confidence threshold", () => {
  const parsedButStored = Math.max(config.references.ocrConfidenceThreshold, config.references.storeOriginalConfidenceThreshold / 2);
  const parsedAndDiscarded = Math.min(1, Math.max(config.references.storeOriginalConfidenceThreshold, config.references.ocrConfidenceThreshold) + 0.01);
  assert.deepEqual(decideLiteParseOcr({ text: "正文", confidence: parsedButStored, pages: 1, confidenceSamples: 4 }), {
    ok: true,
    shouldStoreOriginal: parsedButStored < config.references.storeOriginalConfidenceThreshold,
  });
  assert.deepEqual(decideLiteParseOcr({ text: "正文", confidence: parsedAndDiscarded, pages: 1, confidenceSamples: 4 }), {
    ok: true,
    shouldStoreOriginal: false,
  });
});
