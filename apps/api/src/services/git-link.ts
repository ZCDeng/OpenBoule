/**
 * Git-linked 项目链接服务（U4 / C 簇 P0 安全核心）。
 *
 * 两路径分离：
 *  - localDir（仅本地模式）：agent cwd 直指用户真实 repo。路径穿越/symlink 逃逸是最高风险——
 *    realpath 规范化后必须落在用户 home 子树内，拒 `..`/`~`/symlink 跳出；执行前再校验一次（防 TOCTOU）。
 *  - gitUrl（团队/本地）：clone 到服务端 workspace，仅校验 URL 形态（无本地文件系统暴露）。
 */

import { realpath, stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, sep } from "node:path";

export type LinkMode = "gitUrl" | "localDir";

export interface LinkResult {
  ok: boolean;
  /** 规范化后的真实绝对路径（localDir 模式）。 */
  resolvedDir?: string;
  error?: string;
}

/** 目标路径是否在 base 子树内（含等于 base）。两者都应已 realpath。 */
export function isWithin(base: string, target: string): boolean {
  const b = base.endsWith(sep) ? base : base + sep;
  return target === base || target.startsWith(b);
}

/** 允许的 localDir 根：用户 home（可经 env BOULE_LOCAL_ROOT 覆盖测试/部署）。 */
export function localRoot(): string {
  return process.env.BOULE_LOCAL_ROOT?.trim() || homedir();
}

/** gitUrl 形态校验（https / ssh / git 协议；不接受本地 file://，避免绕过 localDir 守卫）。 */
export function validateGitUrl(url: string): LinkResult {
  if (!/^(https:\/\/|git@|ssh:\/\/|git:\/\/)/.test(url.trim())) {
    return { ok: false, error: "git_url 需为 https:// / git@ / ssh:// / git:// 形态" };
  }
  return { ok: true };
}

/**
 * 校验 localBaseDir（C 簇）：必须绝对路径 → realpath → 落在 localRoot 子树内 → 是目录 → 可写 → 含 .git。
 * 任一不满足即拒（fail loud）。返回规范化真实路径供 cwd 使用。
 */
export async function validateLocalDir(input: string): Promise<LinkResult> {
  if (!input || !isAbsolute(input)) return { ok: false, error: "local_base_dir 必须是绝对路径" };
  if (input.includes("\0")) return { ok: false, error: "非法路径" };

  let resolved: string;
  try {
    resolved = await realpath(input); // 解 symlink + 规范化（防 symlink 跳出）
  } catch {
    return { ok: false, error: "路径不存在或不可解析" };
  }

  const root = await realpath(localRoot()).catch(() => localRoot());
  if (!isWithin(root, resolved)) {
    return { ok: false, error: `路径越界：必须在 ${root} 子树内` };
  }

  try {
    const s = await stat(resolved);
    if (!s.isDirectory()) return { ok: false, error: "不是目录" };
  } catch {
    return { ok: false, error: "无法 stat 目标" };
  }

  try {
    await access(resolved, constants.W_OK);
  } catch {
    return { ok: false, error: "目录不可写" };
  }

  try {
    const g = await stat(join(resolved, ".git"));
    if (!g.isDirectory() && !g.isFile()) return { ok: false, error: "目录不含 .git（非 git repo）" };
  } catch {
    return { ok: false, error: "目录不含 .git（非 git repo）" };
  }

  return { ok: true, resolvedDir: resolved };
}

/**
 * 执行前再校验（防 TOCTOU：链接时合法、执行时被换成逃逸 symlink）。
 * agent runner 启动前调用——返回可安全用作 cwd 的路径，或抛错拒绝执行。
 */
export async function resolveSafeCwd(localBaseDir: string): Promise<string> {
  const r = await validateLocalDir(localBaseDir);
  if (!r.ok || !r.resolvedDir) throw new Error(`git-linked workspace 校验失败：${r.error}`);
  return r.resolvedDir;
}
