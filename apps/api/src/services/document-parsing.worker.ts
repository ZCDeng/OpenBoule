import { parentPort, workerData } from "node:worker_threads";
import { Readable } from "node:stream";
import yauzl from "yauzl";

const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_RATIO = 20;
const MIN_TEXT_CHARS = 80;

interface WorkerInput { buffer: Buffer; mimeType: string; filename: string }
interface ParseResult { signal: "text" | "empty" | "partial"; text: string; detail?: string }

function stripXml(xml: string): string {
  return xml
    .replace(/<\/?(w:p|a:p|row|si|c|x:t|t)[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function streamToBuffer(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) throw new Error("ZIP_ENTRY_TOO_LARGE");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function openZip(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error("ZIP_OPEN_FAILED"));
      else resolve(zip);
    });
  });
}

async function extractOfficeText(buffer: Buffer, mimeType: string): Promise<ParseResult> {
  const zip = await openZip(buffer);
  const wanted = (name: string) => {
    if (mimeType.includes("wordprocessingml")) return name === "word/document.xml" || /^word\/header\d+\.xml$/.test(name) || /^word\/footer\d+\.xml$/.test(name);
    if (mimeType.includes("presentationml")) return /^ppt\/slides\/slide\d+\.xml$/.test(name) || name === "ppt/notesSlides/notesSlide1.xml";
    if (mimeType.includes("spreadsheetml")) return name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name);
    return false;
  };

  let totalUncompressed = 0;
  const texts: string[] = [];
  try {
    for (;;) {
      const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
        zip.once("entry", resolve);
        zip.once("end", () => resolve(null));
        zip.once("error", reject);
        zip.readEntry();
      });
      if (!entry) break;
      totalUncompressed += entry.uncompressedSize;
      if (totalUncompressed > MAX_UNZIPPED_BYTES || totalUncompressed > buffer.length * MAX_ZIP_RATIO) throw new Error("ZIP_EXPANSION_LIMIT");
      if (/\/$/.test(entry.fileName) || !wanted(entry.fileName)) continue;
      const stream = await new Promise<Readable>((resolve, reject) => {
        zip.openReadStream(entry, (err, rs) => (err || !rs ? reject(err ?? new Error("ZIP_READ_FAILED")) : resolve(rs)));
      });
      texts.push(stripXml((await streamToBuffer(stream, Math.min(entry.uncompressedSize + 1024, MAX_UNZIPPED_BYTES))).toString("utf8")));
    }
  } finally {
    zip.close();
  }
  const text = texts.filter(Boolean).join("\n\n").trim();
  return { signal: text.length >= MIN_TEXT_CHARS ? "text" : text ? "partial" : "empty", text };
}

async function extractPdfText(buffer: Buffer): Promise<ParseResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, isEvalSupported: false, useSystemFonts: true } as any);
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  let imageLikeObjects = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    pages.push(textContent.items.map((item: any) => (typeof item?.str === "string" ? item.str : "")).join(" "));
    const ops = await page.getOperatorList();
    imageLikeObjects += ops.fnArray.filter((fn: number) => fn === (pdfjs as any).OPS.paintImageXObject || fn === (pdfjs as any).OPS.paintJpegXObject || fn === (pdfjs as any).OPS.paintInlineImageXObject).length;
  }
  const text = pages.join("\n\n").replace(/[ \t]{2,}/g, " ").trim();
  if (!text) return { signal: "empty", text };
  if (imageLikeObjects > 0) return { signal: text.length >= MIN_TEXT_CHARS ? "partial" : "empty", text, detail: `imageObjects=${imageLikeObjects}` };
  return { signal: text.length >= MIN_TEXT_CHARS ? "text" : "empty", text };
}

async function main() {
  const input = workerData as WorkerInput;
  const buffer = Buffer.from(input.buffer);
  const result = input.mimeType === "application/pdf" ? await extractPdfText(buffer) : await extractOfficeText(buffer, input.mimeType);
  parentPort?.postMessage({ ok: true, result });
}

main().catch((err) => parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }));
