import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.ts";

export type ParseSignal = "text" | "empty" | "partial";
export type ParseSource = "local-js" | "anthropic";
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

  try {
    const body = await extractScannedWithClaude(input);
    if (!body.trim()) throw new Error("CLAUDE_EMPTY_TEXT");
    return {
      body: body.trim(),
      parseStatus: local.signal === "partial" ? "partial" : "parsed",
      parseSource: "anthropic",
      shouldStoreOriginal: true,
    };
  } catch (err) {
    return {
      body: local.text,
      parseStatus: local.signal === "partial" && local.text ? "partial" : "failed",
      parseSource: local.text ? "local-js" : null,
      shouldStoreOriginal: local.signal === "partial",
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
      if (msg.ok && msg.result) resolve(msg.result);
      else reject(new Error(msg.error ?? "DOCUMENT_PARSE_FAILED"));
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

async function extractScannedWithClaude(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<string> {
  if (process.env.BOULE_ENABLE_CLAUDE_REFERENCE_OCR !== "1") {
    throw new Error("CLAUDE_REFERENCE_OCR_DISABLED");
  }
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
  let out = "";
  for await (const msg of query({ prompt: [prompt] as any, options: { maxTurns: 1, model: config.agent.model } as any })) {
    const content = (msg as any)?.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) if (block?.type === "text" && typeof block.text === "string") out += block.text;
    }
    if ((msg as any)?.type === "result" && typeof (msg as any).result === "string") out += (msg as any).result;
  }
  return out;
}
