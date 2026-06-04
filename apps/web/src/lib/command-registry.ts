/**
 * ⌘K 命令源逻辑层（U4）。纯逻辑——命令注册、模糊过滤排序、最近项读写。
 *
 * 与 React/DOM 解耦（不在此层调 navigate；命令只描述 path，由 UI 层执行），
 * 最近项走注入式 storage，便于 node:test 不起浏览器测（沿用 lib/api.ts 注入 fetchImpl 的约定）。
 *
 * 导航命令源是此层的真值源；Navigation.tsx 的 NAV 形态相同但各自维护（避免 UI→lib 反向耦合）。
 */

export type CommandGroup = "COMMANDS" | "PROJECTS" | "RECENT";

export interface Command {
  /** 稳定唯一 id（如 `nav:/projects` / `project:<id>`），用于最近项持久化与去重。 */
  id: string;
  /** 面向用户的显示文案。 */
  label: string;
  group: CommandGroup;
  /** 额外检索词（拼音/英文别名），与 label 一并参与匹配。 */
  keywords?: string[];
  /** 路由目标；逻辑层只描述，UI 层用 navigate(path) 执行。 */
  path: string;
}

/** 静态导航命令源（与 Navigation.tsx 的 NAV 对齐）。 */
export const NAV_COMMANDS: Command[] = [
  { id: "nav:/projects", label: "项目", group: "COMMANDS", path: "/projects", keywords: ["projects", "xiangmu", "list"] },
  { id: "nav:/methodology", label: "方法论", group: "COMMANDS", path: "/methodology", keywords: ["methodology", "fangfalun"] },
  { id: "nav:/settings", label: "配置", group: "COMMANDS", path: "/settings", keywords: ["settings", "config", "peizhi"] },
];

/** 项目列表 → 动态命令项（项目跳转）。 */
export function projectCommands(projects: { id: string; name: string }[]): Command[] {
  return projects.map((p) => ({
    id: `project:${p.id}`,
    label: p.name,
    group: "PROJECTS" as const,
    path: `/projects/${p.id}`,
  }));
}

/** q 的字符是否按序出现在 text 中（轻量子序列匹配，给模糊查询兜底）。 */
function isSubsequence(q: string, text: string): boolean {
  let i = 0;
  for (let j = 0; j < text.length && i < q.length; j++) {
    if (text[j] === q[i]) i++;
  }
  return i === q.length;
}

/**
 * 命令对查询串的相关度打分；0 = 不匹配。分越高越靠前。
 * label 完整/前缀/包含 > keyword 命中 > 子序列模糊。大小写不敏感。
 */
export function scoreCommand(cmd: Command, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const label = cmd.label.toLowerCase();
  const keywords = (cmd.keywords ?? []).map((k) => k.toLowerCase());

  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  if (keywords.some((k) => k === q)) return 55;
  if (keywords.some((k) => k.startsWith(q))) return 45;
  if (keywords.some((k) => k.includes(q))) return 40;
  if (isSubsequence(q, label) || keywords.some((k) => isSubsequence(q, k))) return 20;
  return 0;
}

/**
 * 过滤 + 按相关度降序。query 为空返回原序全量（分组/最近项由 buildResults 处理）。
 * 稳定排序：同分保持入参原序。
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return [...commands];
  return commands
    .map((cmd, i) => ({ cmd, i, score: scoreCommand(cmd, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.cmd);
}

// ── 最近项（注入式 storage，去重 + 上限 + 按时间倒序）──

/** localStorage 的最小子集；测试注入内存实现。 */
export interface SimpleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const RECENT_KEY = "boule:cmdk:recent";
export const RECENT_MAX = 5;

/** 读最近执行的命令 id（最新在前）。损坏数据兜底空数组。 */
export function readRecent(storage: SimpleStorage): string[] {
  try {
    const raw = storage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** 记一次执行：去重后置顶、截断到上限、写回。返回更新后的列表。 */
export function recordRecent(storage: SimpleStorage, id: string): string[] {
  const next = [id, ...readRecent(storage).filter((x) => x !== id)].slice(0, RECENT_MAX);
  storage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

// ── 结果聚合（UI 层直接消费）──

export interface GroupedResults {
  recent: Command[];
  commands: Command[];
  projects: Command[];
}

/**
 * 据查询串聚合分组结果：
 * - 空查询：最近项分组在前（从 recentIds 解析），COMMANDS/PROJECTS 给原序全量并剔除已在最近项中的项；
 * - 非空查询：不显最近项，COMMANDS/PROJECTS 各自按相关度过滤。
 * 无匹配则对应分组为空数组（驱动 UI 空态）。
 */
export function buildResults(opts: {
  query: string;
  projects: { id: string; name: string }[];
  recentIds: string[];
  navCommands?: Command[];
}): GroupedResults {
  const nav = opts.navCommands ?? NAV_COMMANDS;
  const projects = projectCommands(opts.projects);
  const all = [...nav, ...projects];
  const query = opts.query.trim();

  if (!query) {
    const byId = new Map(all.map((c) => [c.id, c]));
    const recent = opts.recentIds.map((id) => byId.get(id)).filter((c): c is Command => c != null);
    const recentIds = new Set(recent.map((c) => c.id));
    return {
      recent,
      commands: nav.filter((c) => !recentIds.has(c.id)),
      projects: projects.filter((c) => !recentIds.has(c.id)),
    };
  }

  return {
    recent: [],
    commands: filterCommands(nav, query),
    projects: filterCommands(projects, query),
  };
}
