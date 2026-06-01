import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { ErrorBanner, Skeleton } from "../components/States.tsx";
import { Badge, Button, DataRow, PageHeader, PageShell, Panel, PanelHeader, SelectInput, TextInput } from "../components/Brutalist.tsx";

interface RuntimeSettings {
  mode: "local" | "team";
  claudeOnly: boolean;
  agent: { model: string; runtime: string; invocationMode: string; cliOrApiSelectableByUser: boolean; researcherMaxTurns: number; reasoningMaxTurns: number; watchdogMs: number; };
  search: { provider: string; enabled: boolean; url: string | null; tools: string[]; disabledBehavior: string; providers: { id: string; label: string; enabled: boolean; url: string | null; tools: string[]; selected: boolean }[]; };
  cli: { mcpCommand: string; submitExample: string; };
  apiKeys: { auth: string; management: string; };
}
interface ApiKeyRow { id: string; name: string; prefix: string; scope: "read" | "write"; projectIds: string[] | null; revokedAt: string | null; lastUsedAt: string | null; createdAt: string; }

export function SettingsPage() {
  const api = useAuth((s) => s.api);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const runtime = useQuery({ queryKey: ["settings-runtime"], queryFn: () => api.json<RuntimeSettings>("/api/settings/runtime") });
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api.json<{ keys: ApiKeyRow[] }>("/api/api-keys") });
  const createKey = useMutation({
    mutationFn: () => api.json<{ id: string; prefix: string; apiKey: string }>("/api/api-keys", { method: "POST", body: JSON.stringify({ name, scope, projectIds: null }) }),
    onSuccess: (res) => { setCreatedKey(res.apiKey); setName(""); void qc.invalidateQueries({ queryKey: ["api-keys"] }); },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.json(`/api/api-keys/${id}`, { method: "DELETE" }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }) });
  const data = runtime.data;

  return (
    <PageShell wide>
      <PageHeader eyebrow="Nº 05 — CONTROL PLANE" title="配置与密钥">
        当前登录用户即配置管理员。这里展示运行时、Claude 调用路径、检索 Provider 与个人 API Key。
      </PageHeader>

      <div className="mt-8 space-y-8">
        {runtime.isLoading ? <Skeleton rows={4} /> : runtime.isError || !data ? <ErrorBanner severity="P1" message="加载配置失败" onRetry={() => void runtime.refetch()} /> : (
          <div className="boule-grid boule-grid--2">
            <Panel>
              <PanelHeader k="RUNTIME" title="运行时状态" />
              <div className="boule-panel-body">
                <dl>
                  <DataRow label="模式" value={data.mode} />
                  <DataRow label="模型" value={data.agent.model} />
                  <DataRow label="Runtime" value={data.agent.runtime} />
                  <DataRow label="调用方式" value={data.agent.invocationMode} />
                </dl>
                <p className="mt-4 text-sm text-[#33332e]">OpenConsult/Boule 是 Claude-only 工作台：不支持其它模型；模型调用由服务端环境和 Agent SDK 认证状态决定。</p>
              </div>
            </Panel>
            <Panel>
              <PanelHeader k="SEARCH" title="MCP / Web 检索" />
              <div className="boule-panel-body">
                <dl>
                  <DataRow label="Provider" value={data.search.provider} />
                  <DataRow label="状态" value={data.search.enabled ? <Badge tone="blue">已启用</Badge> : <Badge>未启用</Badge>} />
                  <DataRow label="URL" value={data.search.url ?? "off"} />
                  <DataRow label="工具" value={data.search.tools.length ? data.search.tools.join(", ") : "无"} />
                </dl>
                <p className="mt-4 text-sm text-[#33332e]">{data.search.disabledBehavior}。密钥只存在服务端，不会回传到此页。</p>
              </div>
            </Panel>
            <Panel className="md:col-span-2">
              <PanelHeader k="CLI / MCP" title="命令入口" />
              <div className="boule-panel-body grid gap-3 md:grid-cols-2">
                <code className="boule-code">{data.cli.mcpCommand}</code>
                <code className="boule-code">{data.cli.submitExample}</code>
                <p className="text-sm text-[#33332e] md:col-span-2">API Key 走 <code>{data.apiKeys.auth}</code>；{data.apiKeys.management}。</p>
              </div>
            </Panel>
          </div>
        )}

        <Panel>
          <PanelHeader k="API KEYS" title="个人 API Keys">明文只显示一次；撤销后不可恢复。</PanelHeader>
          <div className="boule-panel-body space-y-4">
            <div className="grid gap-2 md:grid-cols-[1fr_160px_auto]">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Key 名称" />
              <SelectInput value={scope} onChange={(e) => setScope(e.target.value as "read" | "write")}>
                <option value="write">write</option>
                <option value="read">read</option>
              </SelectInput>
              <Button disabled={createKey.isPending || name.trim() === ""} onClick={() => createKey.mutate()}>创建 Key</Button>
            </div>
            {createKey.isError && <ErrorBanner severity="P1" message="创建 API Key 失败" />}
            {revoke.isError && <ErrorBanner severity="P1" message="撤销 API Key 失败" />}
            {createdKey && <div className="border-2 border-black bg-[var(--boule-orange)] p-4 text-white"><div className="boule-eyebrow !text-white">明文仅显示一次</div><code className="mt-2 block break-all font-[var(--boule-mono)] text-xs">{createdKey}</code></div>}
            {keys.isLoading ? <Skeleton rows={3} /> : keys.isError ? <ErrorBanner severity="P1" message="加载 API Keys 失败" onRetry={() => void keys.refetch()} /> : (
              <div className="boule-list shadow-none">
                {(keys.data?.keys ?? []).map((key) => (
                  <div key={key.id} className="boule-list-row hover:bg-[var(--boule-paper)] hover:text-black">
                    <div className="min-w-0">
                      <div className="font-[var(--boule-disp)] text-xl font-black tracking-[-0.02em]">{key.name}</div>
                      <div className="mt-1 font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--boule-muted)]">{key.prefix} · {key.scope} · {key.lastUsedAt ? `最近使用 ${new Date(key.lastUsedAt).toLocaleString()}` : "未使用"}</div>
                    </div>
                    <Button variant="secondary" disabled={revoke.isPending} onClick={() => revoke.mutate(key.id)}>撤销</Button>
                  </div>
                ))}
                {keys.data?.keys.length === 0 && <div className="p-6 text-sm text-[var(--boule-muted)]">暂无 API Key。</div>}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
