/**
 * 资源内联（U10）。只内联顶层**相对** <link rel=stylesheet> / <script src>；img/font/url() 保持外链。
 *
 * inline-assets 跑在主 Node 进程、有全文件系统访问权——必须防 SSRF / 路径穿越 / OOM：
 * - scheme 非 file://；带 host 的非私网/loopback/link-local（这些一律不内联）
 * - 相对路径 realpath 必须落在 baseDir 内（防 ../../etc/passwd 与 symlink 逃逸）
 * - stat-then-read：先判大小，带 per-asset + 总量上限，超限跳过（透明记 skipped）
 *
 * 注：v1 报告是 DB artifact body（无文件资源），路由走 renderer.buildReportDocument；
 * 本模块为「文件型报告 + 资源 bundle」就绪，guard 独立测，接入待文件型报告出现。
 */

import { statSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";

export interface InlineCaps {
  perAssetBytes: number; // 单 asset 上限
  totalBytes: number; // 总量上限
}
export const DEFAULT_CAPS: InlineCaps = { perAssetBytes: 512 * 1024, totalBytes: 2 * 1024 * 1024 };

export type PathVerdict = { ok: true; absPath: string } | { ok: false; reason: string };

/** 私网/loopback/link-local/metadata 主机判定（禁内联）。 */
export function isPrivateHost(host: string): boolean {
  let h = host.toLowerCase();
  // 去端口：[::1]:80 取括号内；host:port（单冒号=IPv4/域名）去尾端口；多冒号=IPv6 不动（避免把 ::1 截成 :）
  if (h.startsWith("[")) h = h.slice(1, h.indexOf("]"));
  else if ((h.match(/:/g) ?? []).length === 1) h = h.split(":")[0]!;
  if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
  if (h === "169.254.169.254") return true; // cloud metadata
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local
  if (/^fe80:/i.test(h) || /^fc00:/i.test(h) || /^fd/i.test(h)) return true; // IPv6 link-local/ULA
  return false;
}

/**
 * 校验 asset 引用是否可安全内联。仅相对路径且 realpath 落在 baseDir 内才放行。
 * 任何 scheme（含 file://、http(s)）一律不内联（远程/绝对皆拒）。
 */
export function validateAssetPath(href: string, baseDir: string): PathVerdict {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    // 带 scheme 或 protocol-relative：不内联（file:// 明确拒；http(s) 远程不内联，避 SSRF）
    return { ok: false, reason: "non-relative (scheme/host present)" };
  }
  if (href.startsWith("data:")) return { ok: false, reason: "data uri (already inline)" };

  let realBase: string;
  try {
    realBase = realpathSync(baseDir);
  } catch {
    return { ok: false, reason: "baseDir 不可解析" };
  }
  const abs = resolve(realBase, href);
  if (!existsSync(abs)) return { ok: false, reason: "不存在" };
  let real: string;
  try {
    real = realpathSync(abs); // 解 symlink，防软链逃逸
  } catch {
    return { ok: false, reason: "realpath 失败" };
  }
  if (real !== realBase && !real.startsWith(realBase + sep)) {
    return { ok: false, reason: "路径穿越（逃出 baseDir）" };
  }
  return { ok: true, absPath: real };
}

export interface InlineResult {
  html: string;
  inlined: string[];
  skipped: { href: string; reason: string }[];
}

const LINK_RE = /<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi;
const SCRIPT_RE = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script\s*>/gi;
const HREF_RE = /\bhref\s*=\s*["']([^"']+)["']/i;

export function inlineAssets(html: string, baseDir: string, caps: InlineCaps = DEFAULT_CAPS): InlineResult {
  const inlined: string[] = [];
  const skipped: { href: string; reason: string }[] = [];
  let total = 0;

  const tryRead = (href: string): string | null => {
    const v = validateAssetPath(href, baseDir);
    if (!v.ok) {
      skipped.push({ href, reason: v.reason });
      return null;
    }
    const size = statSync(v.absPath).size; // stat-then-read：先判大小
    if (size > caps.perAssetBytes) {
      skipped.push({ href, reason: `超单 asset 上限 (${size})` });
      return null;
    }
    if (total + size > caps.totalBytes) {
      skipped.push({ href, reason: "超总量上限" });
      return null;
    }
    total += size;
    inlined.push(href);
    return readFileSync(v.absPath, "utf8");
  };

  let out = html.replace(LINK_RE, (tag) => {
    const m = tag.match(HREF_RE);
    if (!m) return tag;
    const css = tryRead(m[1]!);
    return css === null ? tag : `<style>${css}</style>`;
  });
  out = out.replace(SCRIPT_RE, (tag, src: string) => {
    const js = tryRead(src);
    return js === null ? tag : `<script>${js}</script>`;
  });

  return { html: out, inlined, skipped };
}
