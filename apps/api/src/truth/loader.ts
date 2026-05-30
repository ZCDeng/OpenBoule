/**
 * 从固化快照读取 role prompt / augment-map（U2）。
 * executor（U3）只经此处读真值源——保证读的是 workflow 创建时固化的快照，非实时缓存。
 */

import { sha256 } from "./digest.ts";
import type { AugmentMap, TruthSnapshot } from "./types.ts";

/** role .md 当 system prompt。按 manifest hash 校验（防快照被篡改/损坏）。 */
export function loadRolePrompt(snapshot: TruthSnapshot, roleName: string): string {
  const path = `skills/roles/${roleName}.md`;
  const content = snapshot.contents[path];
  if (content === undefined) {
    throw new Error(`role 不在快照中: ${path}（快照 @${snapshot.commit_sha.slice(0, 7)}）`);
  }
  const entry = snapshot.manifest.find((m) => m.path === path);
  if (!entry || entry.hash !== sha256(content)) {
    throw new Error(`快照内容与 manifest hash 不符: ${path}（疑似损坏/篡改）`);
  }
  return content;
}

/** 列出快照中的 role 名（去掉 skills/roles/ 前缀与 .md 后缀）。 */
export function listRoles(snapshot: TruthSnapshot): string[] {
  return snapshot.manifest
    .map((m) => m.path)
    .filter((p) => /^skills\/roles\/[^/]+\.md$/.test(p))
    .map((p) => p.replace(/^skills\/roles\//, "").replace(/\.md$/, ""))
    .sort();
}

/**
 * 解析 augment-map.md 为结构化（checkpoint 时 PM offer 用）。
 * 尽力而为：按 `## <phase>` 标题分组，收集其下 `- ` 列表项；解析失败仍保留 raw。
 */
export function parseAugmentMap(snapshot: TruthSnapshot): AugmentMap {
  const raw = snapshot.contents["skills/augment-map.md"] ?? "";
  const byPhase: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of raw.split("\n")) {
    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1]!.trim();
      byPhase[current] ??= [];
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (item && current) byPhase[current]!.push(item[1]!.trim());
  }
  return { raw, byPhase };
}
