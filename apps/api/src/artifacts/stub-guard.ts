/**
 * 退化护栏（U6，借鉴 open-design）。新版本字节 < 同 artifact 历史最大版本的 20% → 疑似「写崩」。
 *
 * 三态可配：reject（硬拦）/ warn（放行记警告）/ off（停用）。首版无基线 → 恒 ok（无可比对象）。
 */

export type StubMode = "reject" | "warn" | "off";

export const SHRINK_THRESHOLD = 0.2;

export interface StubGuardResult {
  verdict: "ok" | "warn" | "reject";
  newBytes: number;
  baselineBytes: number;
  ratio: number | null; // 无基线为 null
}

/**
 * @param baselineBytes 同 artifact 历史**最大**版本字节数（0 = 首版，无基线）
 */
export function checkStub(newBody: string, baselineBytes: number, mode: StubMode = "warn"): StubGuardResult {
  const newBytes = Buffer.byteLength(newBody, "utf8");
  if (mode === "off" || baselineBytes <= 0) {
    return { verdict: "ok", newBytes, baselineBytes, ratio: baselineBytes > 0 ? newBytes / baselineBytes : null };
  }
  const ratio = newBytes / baselineBytes;
  if (ratio < SHRINK_THRESHOLD) {
    return { verdict: mode === "reject" ? "reject" : "warn", newBytes, baselineBytes, ratio };
  }
  return { verdict: "ok", newBytes, baselineBytes, ratio };
}
