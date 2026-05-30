/**
 * U0 spike — 真值源快照消费（KTD-20）。
 * 生产对应：apps/api/src/truth/sync.ts + truth/digest.ts + truth/drift.ts
 *
 * 验三件事：
 *  1. live 从 GitHub（私有 repo，raw.githubusercontent.com + Bearer）拉 skills/，固化 snapshot
 *  2. executor 读「固化快照」里的 role prompt，而非实时缓存
 *  3. 上游漂移可被聚合 truth_digest O(1) 检出，但在途快照内容不变（reproducibility-first）
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = "ZCDeng/consulting-team";
const BRANCH = "main";
// U0 只验承重的 7 role + SKILL.md + augment-map.md（dispatch/axis 模板来源）
const WANTED = (path: string) =>
  path === "skills/SKILL.md" ||
  path === "skills/augment-map.md" ||
  /^skills\/roles\/[^/]+\.md$/.test(path);

const here = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(here, "..", ".snapshot-cache");

export interface TruthSnapshot {
  commit_sha: string;
  synced_at: string;
  truth_digest: string;
  manifest: { path: string; hash: string }[];
  contents: Record<string, string>; // 固化内容，离线可复现读取
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** 递归键排序的 canonical JSON——truth_digest 的稳定输入（算法 frozen）。 */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON((value as any)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 聚合 truth_digest：O(1) 判同源/判漂移。算法 frozen + 须配 CI fixture。 */
export function computeTruthDigest(
  manifest: { path: string; hash: string }[],
): string {
  const sorted = [...manifest].sort((a, b) => a.path.localeCompare(b.path));
  return sha256(canonicalJSON({ manifest: sorted }));
}

function githubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  // spike fallback：复用 gh 登录。生产换成 fine-grained 只读单仓 PAT（repo 私有，token 必需）。
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}

async function gh(path: string, token: string): Promise<any> {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "boule-u0-spike",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} → HTTP ${res.status}`);
  return res.json();
}

async function fetchRaw(
  sha: string,
  filePath: string,
  token: string,
): Promise<string> {
  const res = await fetch(
    `https://raw.githubusercontent.com/${REPO}/${sha}/${filePath}`,
    { headers: { Authorization: `Bearer ${token}`, "User-Agent": "boule-u0-spike" } },
  );
  if (!res.ok) throw new Error(`raw ${filePath} → HTTP ${res.status}`);
  return res.text();
}

/** live 拉 GitHub + 固化 snapshot（immutable，拒绝覆盖）。 */
export async function createSnapshot(): Promise<TruthSnapshot> {
  const token = githubToken();
  const head = await gh(`repos/${REPO}/commits/${BRANCH}`, token);
  const commit_sha: string = head.sha;
  const tree = await gh(
    `repos/${REPO}/git/trees/${commit_sha}?recursive=1`,
    token,
  );
  const paths: string[] = (tree.tree as any[])
    .filter((n) => n.type === "blob" && WANTED(n.path))
    .map((n) => n.path)
    .sort();

  const contents: Record<string, string> = {};
  const manifest: { path: string; hash: string }[] = [];
  for (const p of paths) {
    const text = await fetchRaw(commit_sha, p, token);
    contents[p] = text;
    manifest.push({ path: p, hash: sha256(text) });
  }

  const snapshot: TruthSnapshot = {
    commit_sha,
    synced_at: new Date().toISOString(),
    truth_digest: computeTruthDigest(manifest),
    manifest,
    contents,
  };

  mkdirSync(CACHE_DIR, { recursive: true });
  const out = join(CACHE_DIR, `${commit_sha}.json`);
  if (existsSync(out)) {
    // immutable：已固化快照绝不重写（reproducibility-first）
    return JSON.parse(readFileSync(out, "utf8")) as TruthSnapshot;
  }
  writeFileSync(out, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

/** executor 从固化快照读 role prompt，并按 manifest hash 校验（非实时缓存）。 */
export function loadRoleFromSnapshot(
  snapshot: TruthSnapshot,
  roleName: string,
): string {
  const path = `skills/roles/${roleName}.md`;
  const content = snapshot.contents[path];
  if (content === undefined) throw new Error(`role 不在快照中: ${path}`);
  const entry = snapshot.manifest.find((m) => m.path === path);
  if (!entry || entry.hash !== sha256(content)) {
    throw new Error(`快照内容与 manifest hash 不符: ${path}`);
  }
  return content;
}

// ── spike3 可独立运行：node u0-truth-sync/sync.ts ──
if (process.argv[1] && process.argv[1].endsWith("sync.ts")) {
  const snap = await createSnapshot();
  const roleCount = snap.manifest.filter((m) =>
    m.path.startsWith("skills/roles/"),
  ).length;
  console.log("── U0-spike3: 真值源快照消费 ──");
  console.log(`commit_sha   : ${snap.commit_sha}`);
  console.log(`truth_digest : ${snap.truth_digest}`);
  console.log(`files frozen : ${snap.manifest.length}（roles: ${roleCount}）`);

  // 验 2：从快照读 role，非实时
  const ia = loadRoleFromSnapshot(snap, "information-architect");
  console.log(`load role    : information-architect.md (${ia.length} chars, hash-verified) ✅`);

  // 验 3：模拟上游漂移 → digest 变，但固化快照内容不变
  const mutated = snap.manifest.map((m, i) =>
    i === 0 ? { ...m, hash: sha256(snap.contents[m.path] + " <upstream edit>") } : m,
  );
  const driftDigest = computeTruthDigest(mutated);
  const drifted = driftDigest !== snap.truth_digest;
  const frozenStillSame =
    loadRoleFromSnapshot(snap, "information-architect") === ia;
  console.log(
    `drift detect : 上游变→digest ${drifted ? "≠" : "="} 旧；在途快照读值不变=${frozenStillSame} ${
      drifted && frozenStillSame ? "✅" : "❌"
    }`,
  );

  // 验 truth_digest 可复现（frozen fixture 雏形）
  const recompute = computeTruthDigest(snap.manifest);
  console.log(
    `digest repro : 重算=${recompute === snap.truth_digest ? "稳定" : "漂移"} ${
      recompute === snap.truth_digest ? "✅" : "❌"
    }`,
  );
}
