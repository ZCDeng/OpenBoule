/**
 * ⌘K 命令源逻辑层测试（U4）。过滤排序 / 最近项分组 / 持久化去重置顶 / 动态项合并。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NAV_COMMANDS,
  projectCommands,
  scoreCommand,
  filterCommands,
  readRecent,
  recordRecent,
  buildResults,
  RECENT_KEY,
  RECENT_MAX,
  type SimpleStorage,
} from "../src/lib/command-registry.ts";

/** 内存 storage：注入替代 localStorage，不依赖 DOM。 */
function memStorage(seed: Record<string, string> = {}): SimpleStorage & { dump: () => Record<string, string> } {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    dump: () => Object.fromEntries(m),
  };
}

const PROJECTS = [
  { id: "p1", name: "新能源市场尽调" },
  { id: "p2", name: "并购方案评估" },
];

// ── scoreCommand / filterCommands ──

test("scoreCommand：完整匹配 > 前缀 > 包含 > keyword > 无匹配", () => {
  const cmd = NAV_COMMANDS[0]!; // 项目 / keywords: projects
  assert.equal(scoreCommand(cmd, "项目"), 100);
  assert.ok(scoreCommand(cmd, "proj") > 0); // keyword 前缀
  assert.equal(scoreCommand(cmd, "settings"), 0); // 不匹配
  assert.equal(scoreCommand(cmd, "   "), 0); // 空白查询不匹配
});

test("filterCommands happy：按相关度降序返回匹配项", () => {
  const cmds = projectCommands(PROJECTS);
  const out = filterCommands(cmds, "评估");
  assert.equal(out.length, 1);
  assert.equal(out[0]!.label, "并购方案评估");
});

test("filterCommands：空查询返回原序全量", () => {
  const out = filterCommands(NAV_COMMANDS, "");
  assert.deepEqual(out.map((c) => c.id), NAV_COMMANDS.map((c) => c.id));
});

test("filterCommands：查询无匹配返回空数组", () => {
  assert.deepEqual(filterCommands(NAV_COMMANDS, "zzz不存在的查询"), []);
});

// ── 最近项持久化 ──

test("recordRecent：记录一次后 storage 含该项", () => {
  const s = memStorage();
  recordRecent(s, "nav:/projects");
  assert.deepEqual(JSON.parse(s.dump()[RECENT_KEY]!), ["nav:/projects"]);
  assert.deepEqual(readRecent(s), ["nav:/projects"]);
});

test("recordRecent：重复执行同项去重且置顶", () => {
  const s = memStorage();
  recordRecent(s, "a");
  recordRecent(s, "b");
  recordRecent(s, "a"); // 再次 a → 应置顶且不重复
  assert.deepEqual(readRecent(s), ["a", "b"]);
});

test("recordRecent：超过上限截断保留最新", () => {
  const s = memStorage();
  for (let i = 0; i < RECENT_MAX + 3; i++) recordRecent(s, `c${i}`);
  const recent = readRecent(s);
  assert.equal(recent.length, RECENT_MAX);
  assert.equal(recent[0], `c${RECENT_MAX + 2}`); // 最新在前
});

test("readRecent：损坏数据兜底空数组", () => {
  assert.deepEqual(readRecent(memStorage({ [RECENT_KEY]: "not-json" })), []);
  assert.deepEqual(readRecent(memStorage({ [RECENT_KEY]: '{"x":1}' })), []);
});

// ── buildResults 聚合 ──

test("buildResults：空查询且无最近项 → 全部命令默认序，recent 空", () => {
  const r = buildResults({ query: "", projects: PROJECTS, recentIds: [] });
  assert.deepEqual(r.recent, []);
  assert.deepEqual(r.commands.map((c) => c.id), NAV_COMMANDS.map((c) => c.id));
  assert.equal(r.projects.length, 2);
});

test("buildResults：空查询有最近项 → 最近项解析在前，且从其它分组剔除", () => {
  const r = buildResults({ query: "", projects: PROJECTS, recentIds: ["nav:/settings", "project:p1"] });
  assert.deepEqual(r.recent.map((c) => c.id), ["nav:/settings", "project:p1"]);
  // 已进入 recent 的项不再出现在 commands/projects
  assert.ok(!r.commands.some((c) => c.id === "nav:/settings"));
  assert.ok(!r.projects.some((c) => c.id === "project:p1"));
});

test("buildResults：最近项含已失效 id 时安全忽略", () => {
  const r = buildResults({ query: "", projects: PROJECTS, recentIds: ["project:gone", "nav:/projects"] });
  assert.deepEqual(r.recent.map((c) => c.id), ["nav:/projects"]); // 失效 project:gone 被丢弃
});

test("buildResults：动态项合并 → 项目名匹配查询出现在 PROJECTS 分组", () => {
  const r = buildResults({ query: "尽调", projects: PROJECTS, recentIds: [] });
  assert.deepEqual(r.recent, []);
  assert.equal(r.commands.length, 0); // 导航命令无匹配
  assert.deepEqual(r.projects.map((c) => c.label), ["新能源市场尽调"]);
});

test("buildResults：非空查询不显最近项", () => {
  const r = buildResults({ query: "项目", projects: PROJECTS, recentIds: ["nav:/settings"] });
  assert.deepEqual(r.recent, []);
  assert.ok(r.commands.some((c) => c.id === "nav:/projects"));
});
