/**
 * 真值源同步类型（U2，R6）。
 */

/** 单文件清单项：路径 + 内容 sha256。 */
export interface ManifestEntry {
  path: string;
  hash: string;
}

/**
 * 固化快照（workflow 创建时写入 `workflows.truth_snapshot`，immutable）。
 * 所有 phase / retry / redo 只读它——保证"改 skill 只影响新 workflow"。
 */
export interface TruthSnapshot {
  commit_sha: string;
  synced_at: string; // ISO
  truth_digest: string; // 聚合锚点，见 digest.ts（frozen 算法）
  manifest: ManifestEntry[];
  /** 固化内容，key=repo 相对路径。离线/复现读取，不再回源。 */
  contents: Record<string, string>;
}

/** 同步结果（admin 同步端点 / 启动同步返回，U6 包成 HTTP）。 */
export interface SyncResult {
  source: "github" | "cache"; // 命中网络还是降级本地缓存
  commit_sha: string;
  truth_digest: string;
  files: string[];
  synced_at: string;
}

/** drift 检测报告：上游 HEAD 与在用快照是否漂移（不修改在途 workflow）。 */
export interface DriftReport {
  head_commit_sha: string;
  head_truth_digest: string;
  checked_at: string;
  /** 在用快照里 digest 与 HEAD 不一致的（这些 workflow 仍合法读旧快照，仅"上游已变"）。 */
  stale_digests: string[];
  drifted: boolean;
}

/** augment-map.md 解析后的结构（checkpoint 时 PM offer 用）。 */
export interface AugmentMap {
  /** 原始 markdown（保底，解析失败时仍可用）。 */
  raw: string;
  /** 结构化条目：phase → 可选 augment 列表。解析尽力而为。 */
  byPhase: Record<string, string[]>;
}
