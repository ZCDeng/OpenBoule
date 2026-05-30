/**
 * 真值源同步服务（U2，R6）。
 * 生产化 spike3（`spikes/u0-truth-sync/sync.ts`）：拉取私有 repo `skills/` → 本地缓存
 * → 产出 frozen `TruthSnapshot`。GitHub 不可用时降级本地缓存。
 *
 * **快照写入收口**：`createFrozenSnapshot()` 是 `workflows.truth_snapshot` 值的**唯一**
 * 生产者（U4 创建 workflow 时调用它取值再 INSERT）。配 `tests/truth/write-funnel.guard.test.ts`
 * 防旁路。stale 由 drift.ts 翻状态位，**绝不重写已固化 snapshot 内容**（reproducibility-first）。
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { computeTruthDigest, sha256 } from "./digest.ts";
import type { ManifestEntry, SyncResult, TruthSnapshot } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..", "..");
const CACHE_DIR = process.env.SKILLS_CACHE_DIR ?? join(REPO_ROOT, "skills-cache");

const REPO = process.env.TRUTH_SOURCE_REPO ?? "ZCDeng/consulting-team";
const BRANCH = process.env.TRUTH_SOURCE_BRANCH ?? "main";

/** U0 验证：只承重 7 role + SKILL.md + augment-map.md。 */
export function isWantedPath(path: string): boolean {
  return (
    path === "skills/SKILL.md" ||
    path === "skills/augment-map.md" ||
    /^skills\/roles\/[^/]+\.md$/.test(path)
  );
}

// ── GitHub 访问（私有 repo → token 强制，fail loud）──

export function requireGithubToken(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t || t.trim() === "") {
    throw new Error(
      "缺少 GITHUB_TOKEN：真值源 repo 为私有，token 强制（生产用 fine-grained 只读单仓 Contents PAT）。见 .env.example",
    );
  }
  return t.trim();
}

async function gh(path: string, token: string): Promise<any> {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "boule-truth-sync",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} → HTTP ${res.status}`);
  return res.json();
}

async function fetchRaw(sha: string, filePath: string, token: string): Promise<string> {
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${filePath}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "boule-truth-sync" },
  });
  if (!res.ok) throw new Error(`raw ${filePath} → HTTP ${res.status}`);
  return res.text();
}

/**
 * 启动期 dry-run 校验 token：能访问目标 repo 即通过；401/403 直接 fail loud。
 * 无法从 API 确认"是否只读单仓"，故对**非私有** repo 额外 warn（私有才是预期）。
 */
export async function validateGithubToken(): Promise<{ visibility: string }> {
  const token = requireGithubToken();
  const meta = await gh(`repos/${REPO}`, token);
  if (meta.visibility && meta.visibility !== "private") {
    console.warn(`⚠️ 真值源 repo 可见性=${meta.visibility}（预期 private）；确认 token 与 repo 配置`);
  }
  return { visibility: meta.visibility ?? "unknown" };
}

// ── 本地缓存 ──

function writeCache(snapshot: TruthSnapshot): void {
  for (const [path, content] of Object.entries(snapshot.contents)) {
    const dest = join(CACHE_DIR, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  // 缓存元信息（commit_sha + digest），供降级判断
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(
    join(CACHE_DIR, ".truth-meta.json"),
    JSON.stringify(
      { commit_sha: snapshot.commit_sha, truth_digest: snapshot.truth_digest, synced_at: snapshot.synced_at },
      null,
      2,
    ),
  );
}

function readFromCache(): TruthSnapshot | null {
  const metaPath = join(CACHE_DIR, ".truth-meta.json");
  if (!existsSync(metaPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const contents: Record<string, string> = {};
  const manifest: ManifestEntry[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.name.endsWith(".md")) {
        // 缓存内文件已含 "skills/" 前缀（writeCache 用 repo 相对路径落盘），
        // 故 relative(CACHE_DIR, abs) 直接就是 repo 路径，不再补前缀。
        const repoPath = relative(CACHE_DIR, abs).replace(/\\/g, "/");
        if (!isWantedPath(repoPath)) continue;
        const text = readFileSync(abs, "utf8");
        contents[repoPath] = text;
        manifest.push({ path: repoPath, hash: sha256(text) });
      }
    }
  };
  const rolesDir = join(CACHE_DIR, "skills");
  if (!existsSync(rolesDir)) return null;
  walk(rolesDir);
  if (manifest.length === 0) return null;
  return {
    commit_sha: meta.commit_sha,
    synced_at: meta.synced_at,
    truth_digest: computeTruthDigest(manifest),
    manifest,
    contents,
  };
}

// ── 同步 ──

/** live 从 GitHub 拉取 → 写缓存 → 返回 frozen snapshot。失败抛错（由 syncTruthSource 决定是否降级）。 */
export async function pullHeadSnapshot(): Promise<TruthSnapshot> {
  const token = requireGithubToken();
  const head = await gh(`repos/${REPO}/commits/${BRANCH}`, token);
  const commit_sha: string = head.sha;
  const tree = await gh(`repos/${REPO}/git/trees/${commit_sha}?recursive=1`, token);
  const paths: string[] = (tree.tree as any[])
    .filter((n) => n.type === "blob" && isWantedPath(n.path))
    .map((n) => n.path)
    .sort();

  const contents: Record<string, string> = {};
  const manifest: ManifestEntry[] = [];
  for (const p of paths) {
    const text = await fetchRaw(commit_sha, p, token);
    contents[p] = text;
    manifest.push({ path: p, hash: sha256(text) });
  }
  return {
    commit_sha,
    synced_at: new Date().toISOString(),
    truth_digest: computeTruthDigest(manifest),
    manifest,
    contents,
  };
}

/**
 * 同步真值源。优先 GitHub；不可用降级本地缓存（优雅降级）。
 * 返回 SyncResult（U6 admin 端点包成 HTTP）。
 */
export async function syncTruthSource(): Promise<SyncResult> {
  let snapshot: TruthSnapshot;
  let source: "github" | "cache";
  try {
    snapshot = await pullHeadSnapshot();
    writeCache(snapshot);
    source = "github";
  } catch (err) {
    const cached = readFromCache();
    if (!cached) {
      throw new Error(
        `真值源同步失败且无本地缓存可降级：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    console.warn(`⚠️ GitHub 不可用，降级本地缓存（${err instanceof Error ? err.message : err}）`);
    snapshot = cached;
    source = "cache";
  }
  return {
    source,
    commit_sha: snapshot.commit_sha,
    truth_digest: snapshot.truth_digest,
    files: snapshot.manifest.map((m) => m.path),
    synced_at: snapshot.synced_at,
  };
}

/**
 * **快照唯一生产者**（写入收口）。U4 创建 workflow 时调用，取返回值 INSERT 进
 * `workflows.truth_snapshot`。除本函数外，任何代码不得自行构造 truth_snapshot。
 */
export async function createFrozenSnapshot(): Promise<TruthSnapshot> {
  try {
    const snap = await pullHeadSnapshot();
    writeCache(snap);
    return Object.freeze(snap);
  } catch (err) {
    const cached = readFromCache();
    if (!cached) throw err;
    console.warn("⚠️ createFrozenSnapshot 降级本地缓存");
    return Object.freeze(cached);
  }
}

export { CACHE_DIR, REPO, BRANCH };
