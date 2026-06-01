import { test } from "node:test";
import assert from "node:assert/strict";
import {
  providerToMcpServers,
  publicSearchSettings,
  resolveSearchProviderChain,
  selectFirstConfiguredSearchProvider,
  type SearchProviderConfig,
} from "../../src/services/search-providers.ts";

const aditly: SearchProviderConfig = {
  id: "aditly",
  label: "Aditly MCP",
  enabled: true,
  url: "http://127.0.0.1:8643/mcp/",
  tools: ["mcp__aditly__anspire_web_search"],
  mcpServerName: "aditly",
  mcpServerConfig: { type: "http", url: "http://127.0.0.1:8643/mcp/" },
};
const anysearch: SearchProviderConfig = {
  id: "anysearch",
  label: "anysearch MCP",
  enabled: true,
  url: "https://search.example/mcp",
  tools: ["mcp__anysearch__web_search"],
  mcpServerName: "anysearch",
  mcpServerConfig: { type: "http", url: "https://search.example/mcp", headers: { Authorization: "Bearer secret" } },
};

test("configured chain selects first enabled provider and registers only it", () => {
  const resolved = selectFirstConfiguredSearchProvider([aditly, anysearch]);
  assert.equal(resolved.selected?.id, "aditly");
  assert.deepEqual(providerToMcpServers(resolved.selected), { aditly: aditly.mcpServerConfig });
});

test("pre-flight probe skips unreachable provider and falls back", async () => {
  const resolved = await resolveSearchProviderChain([aditly, anysearch], async (provider) => provider.id === "anysearch");
  assert.equal(resolved.selected?.id, "anysearch");
});

test("all providers unavailable becomes fail-loud no-web state", async () => {
  const resolved = await resolveSearchProviderChain([aditly, anysearch], async () => false);
  const settings = publicSearchSettings(resolved);
  assert.equal(settings.enabled, false);
  assert.equal(settings.provider, "none");
  assert.match(settings.disabledBehavior, /未联网检索/);
});

test("public settings scrub provider keys", () => {
  const json = JSON.stringify(publicSearchSettings({ selected: anysearch, providers: [anysearch], disabledBehavior: "x" }));
  assert.equal(json.includes("secret"), false);
});
