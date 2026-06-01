import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { ErrorBanner, Skeleton } from "../components/States.tsx";

interface RuntimeSettings {
  mode: "local" | "team";
  claudeOnly: boolean;
  agent: {
    model: string;
    runtime: string;
    invocationMode: string;
    cliOrApiSelectableByUser: boolean;
    researcherMaxTurns: number;
    reasoningMaxTurns: number;
    watchdogMs: number;
  };
  search: {
    provider: string;
    enabled: boolean;
    url: string | null;
    tools: string[];
    disabledBehavior: string;
    providers: { id: string; label: string; enabled: boolean; url: string | null; tools: string[]; selected: boolean }[];
  };
  cli: {
    mcpCommand: string;
    submitExample: string;
  };
  apiKeys: {
    auth: string;
    management: string;
  };
}

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "write";
  projectIds: string[] | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export function SettingsPage() {
  const api = useAuth((s) => s.api);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const runtime = useQuery({
    queryKey: ["settings-runtime"],
    queryFn: () => api.json<RuntimeSettings>("/api/settings/runtime"),
  });
  const keys = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api.json<{ keys: ApiKeyRow[] }>("/api/api-keys"),
  });

  const createKey = useMutation({
    mutationFn: () =>
      api.json<{ id: string; prefix: string; apiKey: string }>("/api/api-keys", {
        method: "POST",
        body: JSON.stringify({ name, scope, projectIds: null }),
      }),
    onSuccess: (res) => {
      setCreatedKey(res.apiKey);
      setName("");
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.json(`/api/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const data = runtime.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl">配置</h1>
        <p className="text-sm text-neutral-500">当前登录用户即配置管理员。此页展示运行配置和个人 API Key，不引入单独管理员角色。</p>
      </header>

      {runtime.isLoading ? (
        <Skeleton rows={4} />
      ) : runtime.isError || !data ? (
        <ErrorBanner severity="P1" message="加载配置失败" onRetry={() => void runtime.refetch()} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-medium">运行时状态</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="模式" value={data.mode} />
              <Row label="模型" value={data.agent.model} />
              <Row label="Runtime" value={data.agent.runtime} />
              <Row label="调用方式" value={data.agent.invocationMode} />
            </dl>
            <p className="mt-3 text-xs text-neutral-500">
              OpenConsult/Boule 是 Claude-only 工作台：不支持其它模型；需要服务端具备 Claude CLI 会话或 Anthropic Key。Web 端当前不提供“CLI 或 API 调模型”的用户级选择；模型调用由服务端环境和 Agent SDK 认证状态决定。
            </p>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-medium">MCP / Web 检索</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Provider" value={data.search.provider} />
              <Row label="状态" value={data.search.enabled ? "已启用" : "未启用"} />
              <Row label="URL" value={data.search.url ?? "off"} />
              <Row label="工具" value={data.search.tools.length ? data.search.tools.join(", ") : "无"} />
            </dl>
            <p className="mt-3 text-xs text-neutral-500">{data.search.disabledBehavior}。</p>
            <p className="mt-2 text-xs text-neutral-500">
              普通用户优先使用 Aditly；当 Aditly 关闭或 pre-flight 不可达时可降级到 anysearch。服务端需配置相应 MCP URL 与检索服务密钥，密钥不会回传到此页。
            </p>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4 md:col-span-2">
            <h2 className="text-sm font-medium">CLI / MCP 使用</h2>
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
              <code className="rounded bg-neutral-100 px-3 py-2">{data.cli.mcpCommand}</code>
              <code className="rounded bg-neutral-100 px-3 py-2">{data.cli.submitExample}</code>
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              API Key 走 <code>{data.apiKeys.auth}</code>；{data.apiKeys.management}。
            </p>
          </section>
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-medium">API Keys</h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key 名称"
            className="min-w-56 rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          <select value={scope} onChange={(e) => setScope(e.target.value as "read" | "write")} className="rounded border border-neutral-300 px-3 py-2 text-sm">
            <option value="write">write</option>
            <option value="read">read</option>
          </select>
          <button
            disabled={createKey.isPending || name.trim() === ""}
            onClick={() => createKey.mutate()}
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            创建 Key
          </button>
        </div>
        {createKey.isError && <ErrorBanner severity="P1" message="创建 API Key 失败" />}
        {revoke.isError && <ErrorBanner severity="P1" message="撤销 API Key 失败" />}
        {createdKey && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div>明文仅显示一次：</div>
            <code className="mt-1 block break-all">{createdKey}</code>
          </div>
        )}
        {keys.isLoading ? (
          <Skeleton rows={3} />
        ) : keys.isError ? (
          <ErrorBanner severity="P1" message="加载 API Keys 失败" onRetry={() => void keys.refetch()} />
        ) : (
          <div className="divide-y divide-neutral-200 rounded border border-neutral-200">
            {(keys.data?.keys ?? []).map((key) => (
              <div key={key.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{key.name}</div>
                  <div className="text-xs text-neutral-500">
                    {key.prefix} · {key.scope} · {key.lastUsedAt ? `最近使用 ${new Date(key.lastUsedAt).toLocaleString()}` : "未使用"}
                  </div>
                </div>
                <button
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(key.id)}
                  className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
                >
                  撤销
                </button>
              </div>
            ))}
            {keys.data?.keys.length === 0 && <div className="px-3 py-4 text-sm text-neutral-500">暂无 API Key。</div>}
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-neutral-500">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
