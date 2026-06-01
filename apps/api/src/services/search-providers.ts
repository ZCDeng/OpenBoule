import { config } from "../config.ts";

export interface SearchProviderConfig {
  id: string;
  label: string;
  enabled: boolean;
  url: string | null;
  tools: string[];
  mcpServerName: string;
  mcpServerConfig?: { type: "http"; url: string; headers?: Record<string, string> };
}

export interface ResolvedSearchProvider {
  selected: SearchProviderConfig | null;
  providers: SearchProviderConfig[];
  disabledBehavior: string;
}

const ADITLY_TOOL_NAMES = ["anspire_web_search", "bocha_web_search", "jina_read_url", "reach_read_url"];
const ANYSEARCH_TOOL_NAMES = ["web_search", "read_url"];
export const SEARCH_DISABLED_BEHAVIOR = "researcher 继续运行，但产出必须显式标注未联网检索";

function isOff(value: string | null | undefined): boolean {
  return !value || value.trim() === "" || value.trim().toLowerCase() === "off";
}

function mcpToolNames(server: string, tools: string[]): string[] {
  return tools.map((tool) => `mcp__${server}__${tool}`);
}

export function configuredSearchProviders(): SearchProviderConfig[] {
  const byId: Record<string, SearchProviderConfig> = {
    aditly: buildAditlyProvider(),
    anysearch: buildAnysearchProvider(),
  };
  return config.search.providerOrder.map((id) => byId[id]).filter((p): p is SearchProviderConfig => Boolean(p));
}

function buildAditlyProvider(): SearchProviderConfig {
  const url = config.search.aditlyMcpUrl.trim();
  const enabled = !isOff(url);
  return {
    id: "aditly",
    label: "Aditly MCP",
    enabled,
    url: enabled ? url : null,
    tools: enabled ? mcpToolNames("aditly", ADITLY_TOOL_NAMES) : [],
    mcpServerName: "aditly",
    ...(enabled ? { mcpServerConfig: { type: "http", url } } : {}),
  };
}

function buildAnysearchProvider(): SearchProviderConfig {
  const url = config.search.anysearchMcpUrl.trim();
  const enabled = !isOff(url);
  const headers = config.search.anysearchApiKey ? { Authorization: `Bearer ${config.search.anysearchApiKey}` } : undefined;
  return {
    id: "anysearch",
    label: "anysearch MCP",
    enabled,
    url: enabled ? url : null,
    tools: enabled ? mcpToolNames("anysearch", ANYSEARCH_TOOL_NAMES) : [],
    mcpServerName: "anysearch",
    ...(enabled ? { mcpServerConfig: { type: "http", url, ...(headers ? { headers } : {}) } } : {}),
  };
}

export function selectFirstConfiguredSearchProvider(providers = configuredSearchProviders()): ResolvedSearchProvider {
  return { selected: providers.find((p) => p.enabled) ?? null, providers, disabledBehavior: SEARCH_DISABLED_BEHAVIOR };
}

export async function resolveSearchProviderChain(
  providers = configuredSearchProviders(),
  probe: (provider: SearchProviderConfig) => Promise<boolean> = probeProvider,
): Promise<ResolvedSearchProvider> {
  for (const provider of providers) {
    if (!provider.enabled) continue;
    if (await probe(provider)) return { selected: provider, providers, disabledBehavior: SEARCH_DISABLED_BEHAVIOR };
  }
  return { selected: null, providers, disabledBehavior: SEARCH_DISABLED_BEHAVIOR };
}

export async function probeProvider(provider: SearchProviderConfig): Promise<boolean> {
  if (!provider.enabled || !provider.url) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.search.probeTimeoutMs);
  try {
    const res = await fetch(provider.url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(provider.mcpServerConfig?.headers ?? {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: "boule-health", method: "tools/list", params: {} }),
    });
    // probe 只看 status，主动 drain body 避免 socket 悬挂泄漏。
    res.body?.cancel().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function providerToMcpServers(provider: SearchProviderConfig | null): Record<string, unknown> | undefined {
  if (!provider?.mcpServerConfig) return undefined;
  return { [provider.mcpServerName]: provider.mcpServerConfig };
}

export function publicSearchSettings(resolved = selectFirstConfiguredSearchProvider()): {
  provider: string;
  enabled: boolean;
  url: string | null;
  tools: string[];
  disabledBehavior: string;
  providers: { id: string; label: string; enabled: boolean; url: string | null; tools: string[]; selected: boolean }[];
} {
  return {
    provider: resolved.selected?.label ?? "none",
    enabled: Boolean(resolved.selected),
    url: resolved.selected?.url ?? null,
    tools: resolved.selected?.tools ?? [],
    disabledBehavior: SEARCH_DISABLED_BEHAVIOR,
    providers: resolved.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      enabled: provider.enabled,
      url: provider.url,
      tools: provider.tools,
      selected: provider.id === resolved.selected?.id,
    })),
  };
}
