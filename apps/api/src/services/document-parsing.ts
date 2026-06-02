import { Worker } from "node:worker_threads";
import { fork } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.ts";

export type ParseSignal = "text" | "empty" | "partial";
export type ParseSource = "local-js" | "anthropic" | "liteparse";
export type ParseStatus = "parsed" | "failed" | "partial";

export interface LocalParseResult {
  signal: ParseSignal;
  text: string;
  detail?: string;
}

export interface ReferenceParseResult {
  body: string;
  parseStatus: ParseStatus;
  parseSource: ParseSource | null;
  shouldStoreOriginal: boolean;
  error?: string;
}

const TEXT_MIME_RE = /^(text\/|application\/(json|xml|csv|x-yaml|yaml))/i;
const WORKER_URL = new URL("./document-parsing.worker.ts", import.meta.url);
const OCR_CHILD_PATH = fileURLToPath(new URL("./document-ocr.child.ts", import.meta.url));

export function isTextLikeMime(mimeType: string): boolean {
  return TEXT_MIME_RE.test(mimeType);
}

export async function parseReferenceDocument(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<ReferenceParseResult> {
  if (isTextLikeMime(input.mimeType)) {
    const body = input.buffer.toString("utf8").trim();
    return body
      ? { body, parseStatus: "parsed", parseSource: "local-js", shouldStoreOriginal: false }
      : { body: "", parseStatus: "failed", parseSource: null, shouldStoreOriginal: false, error: "EMPTY_TEXT" };
  }

  let local: LocalParseResult;
  try {
    local = await parseDigitalDocument(input);
  } catch (err) {
    return { body: "", parseStatus: "failed", parseSource: null, shouldStoreOriginal: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (local.signal === "text") {
    return { body: local.text, parseStatus: "parsed", parseSource: "local-js", shouldStoreOriginal: false };
  }

  // 仅 PDF 才进入 OCR 分支：Office 扫描件无法作为合法 Anthropic document media_type 发送，继续按本地文本 partial/failed 映射。
  if (input.mimeType !== "application/pdf") {
    return {
      body: local.text,
      parseStatus: local.signal === "partial" && local.text ? "partial" : "failed",
      parseSource: local.text ? "local-js" : null,
      shouldStoreOriginal: local.signal === "partial",
      error: local.text ? undefined : "EMPTY_TEXT",
    };
  }

  const liteparse = await extractScannedWithLiteParse(input).catch((err): LiteParseOcrResult => ({
    text: "",
    confidence: null,
    pages: 0,
    confidenceSamples: 0,
    error: err instanceof Error ? err.message : String(err),
  }));
  const liteparseDecision = decideLiteParseOcr(liteparse);
  if (liteparseDecision.ok) {
    return {
      body: liteparse.text.trim(),
      parseStatus: "parsed",
      parseSource: "liteparse",
      shouldStoreOriginal: liteparseDecision.shouldStoreOriginal,
    };
  }

  if (config.references.ocrFallback === "claude") {
    try {
      const body = await extractScannedWithClaude(input);
      if (!body.trim()) throw new Error("CLAUDE_EMPTY_TEXT");
      return {
        body: body.trim(),
        parseStatus: "parsed",
        parseSource: "anthropic",
        shouldStoreOriginal: true,
      };
    } catch (err) {
      const claudeError = err instanceof Error ? err.message : String(err);
      return fallbackPdfParseResult(local, `${liteparseDecision.error ?? "LITEPARSE_OCR_FAILED"}; CLAUDE_FALLBACK_FAILED: ${claudeError}`);
    }
  }

  return fallbackPdfParseResult(local, liteparseDecision.error ?? "LITEPARSE_OCR_FAILED");
}

function fallbackPdfParseResult(local: LocalParseResult, error: string): ReferenceParseResult {
  return {
    body: local.text,
    parseStatus: local.signal === "partial" && local.text ? "partial" : "failed",
    parseSource: local.text ? "local-js" : null,
    shouldStoreOriginal: local.signal === "partial",
    error,
  };
}

export function parseDigitalDocument(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<LocalParseResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(WORKER_URL), {
      workerData: input,
      execArgv: ["--experimental-transform-types"],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    const timer = setTimeout(() => {
      worker.terminate().catch(() => undefined);
      reject(new Error("DOCUMENT_PARSE_TIMEOUT"));
    }, config.references.parseTimeoutMs);
    worker.once("message", (msg: { ok: boolean; result?: LocalParseResult; error?: string }) => {
      clearTimeout(timer);
      if (msg.ok && msg.result) {
        resolve(msg.result);
      } else {
        worker.terminate().catch(() => undefined);
        reject(new Error(msg.error ?? "DOCUMENT_PARSE_FAILED"));
      }
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`DOCUMENT_PARSE_WORKER_EXIT_${code}`));
      }
    });
  });
}

/** query() 流式消息的最小形状（只取本函数读到的字段，避免散在各处的 as any）。 */
interface ClaudeQueryMessage {
  type?: string;
  message?: { content?: unknown };
  result?: unknown;
}

export interface LiteParseOcrResult {
  text: string;
  confidence: number | null;
  pages: number;
  confidenceSamples: number;
  error?: string;
}

export interface OcrDecision {
  ok: boolean;
  shouldStoreOriginal: boolean;
  error?: string;
}

export function decideLiteParseOcr(result: LiteParseOcrResult): OcrDecision {
  if (result.error) {
    return { ok: false, shouldStoreOriginal: true, error: `LITEPARSE_OCR_FAILED: ${result.error}` };
  }
  if (!result.text.trim()) {
    return { ok: false, shouldStoreOriginal: true, error: "LITEPARSE_EMPTY_TEXT" };
  }
  if (result.confidence === null) {
    return { ok: false, shouldStoreOriginal: true, error: "LITEPARSE_CONFIDENCE_UNAVAILABLE" };
  }
  if (result.confidence < config.references.ocrConfidenceThreshold) {
    return {
      ok: false,
      shouldStoreOriginal: true,
      error: `LITEPARSE_LOW_CONFIDENCE_${result.confidence.toFixed(3)}`,
    };
  }
  return {
    ok: true,
    shouldStoreOriginal: result.confidence < config.references.storeOriginalConfidenceThreshold,
  };
}

/** 解析 Linux /proc/<pid>/status 的 VmRSS（kB）。读不到/格式不符返回 null。 */
export function parseVmRssKb(status: string): number | null {
  const m = status.match(/^VmRSS:\s+(\d+)\s*kB/m);
  return m ? Number(m[1]) : null;
}

/** 读子进程当前 RSS（kB）。非 Linux / 进程已退出 / 无权限 → null（看门狗静默跳过，回落到超时保护）。 */
function readChildRssKb(pid: number): number | null {
  try {
    return parseVmRssKb(readFileSync(`/proc/${pid}/status`, "utf8"));
  } catch {
    return null;
  }
}

/** FIFO 计数信号量：限制同时在跑的 OCR 子进程数，避免突发上传 fork 风暴/OOM。 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((res) => this.waiters.push(res)); // 等待中不占增量，release 时直接交棒
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next(); // 槽位转交给排队者，active 不变
    else this.active -= 1;
  }
}

const ocrSemaphore = new Semaphore(config.references.ocrMaxConcurrent);

export async function extractScannedWithLiteParse(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<LiteParseOcrResult> {
  await ocrSemaphore.acquire();
  try {
    return await runLiteParseOcrChild(input);
  } finally {
    ocrSemaphore.release();
  }
}

function runLiteParseOcrChild(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<LiteParseOcrResult> {
  return new Promise((resolve, reject) => {
    const child = fork(OCR_CHILD_PATH, [], {
      execArgv: ["--experimental-transform-types", "--max-old-space-size=256"],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { TESSDATA_PREFIX: config.references.tessdataPath, PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV },
    });
    let settled = false;
    let stderr = "";
    let watchdog: ReturnType<typeof setInterval> | undefined;
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-4096);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() => reject(new Error("LITEPARSE_OCR_TIMEOUT")));
    }, config.references.ocrTimeoutMs);
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (watchdog) clearInterval(watchdog);
      fn();
    };
    // 原生堆看门狗：--max-old-space-size 管不到 PDFium/Tesseract 的原生内存，按 RSS 超限即杀子进程，
    // 防恶意/超大 PDF 撑爆容器（plan R8）。仅 Linux 可读 /proc 时生效；其余环境回落到超时保护。
    const rssLimitKb = config.references.ocrMaxRssMb * 1024;
    watchdog = setInterval(() => {
      if (child.pid === undefined) return;
      const rssKb = readChildRssKb(child.pid);
      if (rssKb !== null && rssKb > rssLimitKb) {
        child.kill("SIGKILL");
        settle(() => reject(new Error(`LITEPARSE_OCR_MEMORY_LIMIT_${Math.round(rssKb / 1024)}MB`)));
      }
    }, 500);
    watchdog.unref?.();
    child.once("message", (msg: { ok: boolean; result?: LiteParseOcrResult; error?: string }) => {
      settle(() => {
        if (msg.ok && msg.result) resolve(msg.result);
        else reject(new Error(msg.error ?? "LITEPARSE_OCR_FAILED"));
      });
    });
    child.once("error", (err) => {
      settle(() => reject(err));
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
      settle(() => reject(new Error(`LITEPARSE_OCR_PROCESS_EXIT_${signal ?? code}${suffix}`)));
    });
    child.send({
      buffer: input.buffer,
      language: config.references.ocrLanguage,
      tessdataPath: config.references.tessdataPath,
      maxPages: config.references.ocrMaxPages,
      dpi: config.references.ocrDpi,
    });
  });
}

async function extractScannedWithClaude(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<string> {
  const prompt = {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: "请从这份客户 reference 文档中抽取可读文本。只返回抽取文本，不要总结，不要添加不存在的信息。",
        },
        {
          type: "document",
          source: {
            type: "base64",
            media_type: input.mimeType,
            data: input.buffer.toString("base64"),
          },
        },
      ],
    },
  };
  // Claude 调用跑在 HTTP 主线程，没有截止时间会阻塞请求；用 Promise.race 加 parseTimeoutMs 死线。
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("CLAUDE_OCR_TIMEOUT")), config.references.parseTimeoutMs);
  });
  try {
    return await Promise.race([deadline, drainClaudeQuery(prompt)]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function drainClaudeQuery(prompt: unknown): Promise<string> {
  let result = "";
  let fallback = "";
  for await (const raw of query({ prompt: [prompt] as any, options: { maxTurns: 1, model: config.agent.model } as any })) {
    const msg = raw as ClaudeQueryMessage;
    // 终态 result 是权威输出；正常情况只取它，避免与流式 text block 双计。
    if (msg.type === "result" && typeof msg.result === "string") {
      result = msg.result;
      continue;
    }
    // fallback：若始终没有 result 消息，再用累积的 text content block 兜底。
    const content = msg.message?.content;
    if (Array.isArray(content)) {
      for (const block of content as { type?: string; text?: unknown }[]) {
        if (block?.type === "text" && typeof block.text === "string") fallback += block.text;
      }
    }
  }
  return result || fallback;
}
