import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_OFFICE_REFERENCE_BYTES,
  MAX_PDF_REFERENCE_BYTES,
  MAX_REFERENCE_BYTES,
  validateReferenceFile,
  validateReferenceUpload,
} from "../../src/services/references.ts";

function bytes(prefix: Buffer, size: number): Buffer {
  return Buffer.concat([prefix, Buffer.alloc(Math.max(0, size - prefix.length), 0x20)]);
}

test("reference upload keeps existing JSON text path", () => {
  const ok = validateReferenceUpload({ filename: "brief.md", mimeType: "text/markdown", body: "客户 brief" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.mimeType, "text/markdown");
    assert.equal(ok.body, "客户 brief");
  }
});

test("magic-byte validation rejects disguised PDF", () => {
  const bad = validateReferenceFile({ filename: "malware.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ executable") });
  assert.equal(bad.ok, false);
});

test("PDF and Office limits use detected binary type", () => {
  const pdf = validateReferenceFile({ filename: "deck.pdf", mimeType: "application/octet-stream", buffer: bytes(Buffer.from("%PDF-"), MAX_PDF_REFERENCE_BYTES) });
  assert.equal(pdf.ok, true);
  const pdfTooLarge = validateReferenceFile({ filename: "deck.pdf", mimeType: "application/pdf", buffer: bytes(Buffer.from("%PDF-"), MAX_PDF_REFERENCE_BYTES + 1) });
  assert.equal(pdfTooLarge.ok, false);

  const docx = validateReferenceFile({ filename: "brief.docx", mimeType: "application/octet-stream", buffer: bytes(Buffer.from([0x50, 0x4b, 0x03, 0x04]), MAX_OFFICE_REFERENCE_BYTES) });
  assert.equal(docx.ok, true);
  const docxTooLarge = validateReferenceFile({ filename: "brief.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: bytes(Buffer.from([0x50, 0x4b, 0x03, 0x04]), MAX_OFFICE_REFERENCE_BYTES + 1) });
  assert.equal(docxTooLarge.ok, false);
});

test("text references keep 256KB guard", () => {
  const tooLarge = validateReferenceFile({ filename: "brief.txt", mimeType: "text/plain", buffer: Buffer.alloc(MAX_REFERENCE_BYTES + 1, 0x61) });
  assert.equal(tooLarge.ok, false);
});
