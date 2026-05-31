/**
 * MCP 工具集（U1 / KTD-2）。每个工具都是 thin fetch wrapper → 已运行的 Boule API。
 * MCP server 本身零状态、不碰 DB/文件——全部经 `Authorization: Bearer <api_key>`。
 *
 * Active Context（R2）：不传 workflow/project 时，先 GET /api/active-context 补全。
 *
 * 落地范围（fail loud）：7 个工具映射到**真实**端点。plan 列的 `create_checkpoint` 不在此——
 * checkpoint 由引擎在 phase 边界创建，外部创建语义与现有状态机冲突，挂 Deferred 待设计。
 */

export interface BouleClient {
  baseUrl: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export function createBouleClient(opts: {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): BouleClient {
  const apiKey = opts.apiKey ?? process.env.BOULE_API_KEY ?? "";
  return {
    baseUrl: (opts.baseUrl ?? process.env.BOULE_API_URL ?? "http://localhost:3100").replace(/\/$/, ""),
    apiKey,
    fetchImpl: opts.fetchImpl ?? fetch,
  };
}

/** 统一请求：带 Bearer，非 2xx 抛清晰错误（含 daemon 不可达提示）。 */
async function call(
  client: BouleClient,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let res: Response;
  try {
    res = await client.fetchImpl(`${client.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${client.apiKey}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      // 超时兜底（code-review #3）：半开连接不会无限挂起。
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(
      `无法连接 Boule API（${client.baseUrl}）：daemon 是否在运行？原始错误：${(err as Error).message}`,
    );
  }
  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = (parsed as { message?: string; error?: string } | null)?.message
      ?? (parsed as { error?: string } | null)?.error
      ?? text
      ?? `HTTP ${res.status}`;
    throw new Error(`Boule API ${method} ${path} → ${res.status}：${msg}`);
  }
  return parsed;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** 解析目标 workflow：显式优先，否则回退 active context；都没有 → 清晰错误。 */
async function resolveWorkflow(client: BouleClient, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const ac = (await call(client, "GET", "/api/active-context")) as {
    activeContext?: { workflowId?: string };
  };
  const wid = ac.activeContext?.workflowId;
  if (!wid) {
    throw new Error("未指定 workflow，且 active context 无当前 workflow（请在 Web UI 打开一个，或显式传 workflow）");
  }
  return wid;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function makeTools(client: BouleClient): ToolDef[] {
  return [
    {
      name: "list_projects",
      description: "列出当前 API key 可访问的所有 Boule 项目。",
      inputSchema: { type: "object", properties: {} },
      handler: () => call(client, "GET", "/api/projects"),
    },
    {
      name: "get_active_context",
      description: "返回用户当前在 Web UI 打开的项目/workflow/phase（MCP 自动定位的来源）。",
      inputSchema: { type: "object", properties: {} },
      handler: () => call(client, "GET", "/api/active-context"),
    },
    {
      name: "get_workflow",
      description: "查 workflow 状态（current_phase / status / axes）。不传 workflow 则用 active context。",
      inputSchema: {
        type: "object",
        properties: { workflow: { type: "string", description: "workflow id（可选）" } },
      },
      handler: async (args) => {
        const wid = await resolveWorkflow(client, str(args.workflow));
        return call(client, "GET", `/api/workflows/${wid}`);
      },
    },
    {
      name: "get_documents",
      description: "列出 workflow 各 (phase,type) 最新版本的 artifact（含 stale 标记）。不传则用 active context。",
      inputSchema: {
        type: "object",
        properties: { workflow: { type: "string", description: "workflow id（可选）" } },
      },
      handler: async (args) => {
        const wid = await resolveWorkflow(client, str(args.workflow));
        return call(client, "GET", `/api/workflows/${wid}/artifacts`);
      },
    },
    {
      name: "list_axes",
      description: "列出 workflow 的调研轴（phase1.5 分解结果）。不传则用 active context。",
      inputSchema: {
        type: "object",
        properties: { workflow: { type: "string", description: "workflow id（可选）" } },
      },
      handler: async (args) => {
        const wid = await resolveWorkflow(client, str(args.workflow));
        const wf = (await call(client, "GET", `/api/workflows/${wid}`)) as { axes?: unknown };
        return { axes: wf.axes ?? null };
      },
    },
    {
      name: "submit_artifact",
      description: "提交一份产出到 workflow（落 draft，出现在 Web UI）。需 editor+ 的 write scope key。",
      inputSchema: {
        type: "object",
        properties: {
          workflow: { type: "string", description: "workflow id（可选，缺省用 active context）" },
          type: { type: "string", description: "产出类型，如 research / report" },
          body: { type: "string", description: "产出正文" },
          phase: { type: "string", description: "归属 phase（可选，缺省 external）" },
        },
        required: ["type", "body"],
      },
      handler: async (args) => {
        const wid = await resolveWorkflow(client, str(args.workflow));
        return call(client, "POST", `/api/workflows/${wid}/artifacts`, {
          type: str(args.type),
          body: str(args.body),
          phase: str(args.phase),
        });
      },
    },
    {
      name: "search_research",
      description: "在 workflow 的 research 类 artifact 里按关键词检索（客户端过滤，无需新端点）。",
      inputSchema: {
        type: "object",
        properties: {
          workflow: { type: "string", description: "workflow id（可选）" },
          query: { type: "string", description: "关键词" },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const wid = await resolveWorkflow(client, str(args.workflow));
        const query = (str(args.query) ?? "").toLowerCase();
        const docs = (await call(client, "GET", `/api/workflows/${wid}/artifacts`)) as {
          artifacts?: { id: string; type: string; phase: string }[];
        };
        // 上限 20，防 N+1 失控（code-review #6）；正文拉取并行而非串行。
        const MAX_HITS = 20;
        const all = (docs.artifacts ?? []).filter(
          (a) => a.type.toLowerCase().includes("research") || a.phase.toLowerCase().includes("research"),
        );
        const hits = all.slice(0, MAX_HITS);
        const fetched = await Promise.all(
          hits.map(async (h) => {
            const full = (await call(client, "GET", `/api/artifacts/${h.id}`)) as { body?: string };
            return { h, body: full.body ?? "" };
          }),
        );
        const matched: { id: string; type: string; phase: string; excerpt: string }[] = [];
        for (const { h, body } of fetched) {
          const idx = body.toLowerCase().indexOf(query);
          if (!query || idx >= 0) {
            const start = Math.max(0, idx - 80);
            matched.push({ id: h.id, type: h.type, phase: h.phase, excerpt: body.slice(start, start + 240) });
          }
        }
        return { findings: matched, truncated: all.length > MAX_HITS ? all.length - MAX_HITS : 0 };
      },
    },
  ];
}
