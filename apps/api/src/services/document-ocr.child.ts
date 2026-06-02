import { LiteParse } from "@llamaindex/liteparse";

interface OcrRequest {
  buffer: Buffer;
  language: string;
  tessdataPath?: string;
  maxPages: number;
  dpi: number;
}

interface OcrResponse {
  ok: boolean;
  result?: {
    text: string;
    confidence: number | null;
    pages: number;
    confidenceSamples: number;
  };
  error?: string;
}

function averageConfidence(result: Awaited<ReturnType<LiteParse["parse"]>>): { confidence: number | null; samples: number } {
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
  return { confidence: samples ? total / samples : null, samples };
}

async function handle(req: OcrRequest): Promise<OcrResponse> {
  const parser = new LiteParse({
    ocrEnabled: true,
    ocrLanguage: req.language,
    tessdataPath: req.tessdataPath,
    maxPages: req.maxPages,
    dpi: req.dpi,
    outputFormat: "json",
    quiet: true,
    numWorkers: 1,
  });
  const result = await parser.parse(Buffer.from(req.buffer));
  const confidence = averageConfidence(result);
  return {
    ok: true,
    result: {
      text: result.text.trim(),
      confidence: confidence.confidence,
      pages: result.pages.length,
      confidenceSamples: confidence.samples,
    },
  };
}

process.once("message", (raw) => {
  handle(raw as OcrRequest)
    .then((msg) => process.send?.(msg))
    .catch((err) => {
      const msg: OcrResponse = { ok: false, error: err instanceof Error ? err.message : String(err) };
      process.send?.(msg);
    })
    .finally(() => {
      process.disconnect();
    });
});
