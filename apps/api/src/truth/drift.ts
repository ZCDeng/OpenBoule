/**
 * drift 检测（U2 / KTD-20）。
 * 后台周期任务重算 GitHub HEAD 的 truth_digest，与"在用快照"比对。
 * **不修改在途 workflow**——这些 workflow 仍合法读各自固化的旧快照；drift 只产出
 * "上游已变"的可观测信号，供 UI 提示"现有 workflow 仍用旧快照，新建才生效"。
 */

import { pullHeadSnapshot } from "./sync.ts";
import type { DriftReport } from "./types.ts";

/**
 * @param activeSnapshotDigests 当前在用 workflow 的 truth_digest 列表
 *   （调用方从 `workflows.truth_snapshot->>'truth_digest'` 查得；U2 不直接碰 DB，
 *    保持 truth 模块对 DB 无依赖，便于纯函数测试）。
 */
export async function detectDrift(activeSnapshotDigests: string[]): Promise<DriftReport> {
  const head = await pullHeadSnapshot();
  const headDigest = head.truth_digest;
  const stale = [...new Set(activeSnapshotDigests)].filter((d) => d !== headDigest);
  return {
    head_commit_sha: head.commit_sha,
    head_truth_digest: headDigest,
    checked_at: new Date().toISOString(),
    stale_digests: stale,
    drifted: stale.length > 0,
  };
}
