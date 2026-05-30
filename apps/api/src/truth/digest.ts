/**
 * 聚合 truth_digest（U2 / KTD-20，借鉴 open-design `digest.ts`）。
 *
 * **算法 FROZEN**：改动会让历史快照静默漂移（同源被误判成异源）。
 * 故带显式 `DIGEST_VERSION`——要改算法必须 bump version 并同步更新
 * `tests/truth/digest.test.ts` 的 frozen fixture，CI 锁住。
 *
 * 设计：digest 只锚 manifest（排序后的 {path, hash}）。任何 skill 文件/配置变更
 * 都会改变该文件的 sha256 → 改变 manifest → 改变 digest，故无需再单独 digest
 * "解析后的 config"（那是冗余；解析配置本身就来自这些文件）。
 */

import { createHash } from "node:crypto";

export const DIGEST_VERSION = 1;

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** 递归键排序的 canonical JSON——digest 的稳定输入（顺序无关、空白无关）。 */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(",")}}`;
}

/**
 * 聚合 digest：O(1) 判同源 / 判漂移。输入 manifest 内部先按 path 排序，
 * 故与文件发现顺序无关。
 */
export function computeTruthDigest(
  manifest: { path: string; hash: string }[],
): string {
  const files = [...manifest]
    .map((m) => ({ path: m.path, hash: m.hash }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(canonicalJSON({ version: DIGEST_VERSION, files }));
}
