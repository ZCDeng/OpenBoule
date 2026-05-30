/**
 * Phase 2.5 四态裁决视图（U8 / KTD-21）。徽章=代码裁决结果（数票），verifier 自报不直接采信。
 * 数据源：Phase 2.5 source-verifier 结构化产出（后端落库待 engine↔2.5 wiring；当前由 props 注入，空态友好）。
 */

import { useState } from "react";
import { verdictBadge, type Verdict, type BadgeTone } from "../../lib/derive.ts";
import { EmptyState } from "../../components/States.tsx";

export interface ClaimVerdict {
  claim: string;
  verdict: Verdict;
  survive: number;
  refute: number;
  narrowVersion?: string; // salvage 的窄版
  evidence?: string;
}

const TONE: Record<BadgeTone, string> = {
  green: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  neutral: "bg-neutral-100 text-neutral-600",
};

export function VerdictView({ verdicts }: { verdicts: ClaimVerdict[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (verdicts.length === 0) {
    return <EmptyState title="暂无验证数据" hint="Phase 2.5 对抗验证完成后在此查看四态裁决。" />;
  }
  const stat = verdicts.reduce<Record<Verdict, number>>(
    (acc, v) => ({ ...acc, [v.verdict]: (acc[v.verdict] ?? 0) + 1 }),
    { confirmed: 0, salvage: 0, killed: 0, undetermined: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-4 text-sm text-neutral-600">
        <span>承重声称 {verdicts.length}</span>
        <span className="text-green-700">确认 {stat.confirmed}</span>
        <span className="text-amber-700">挽救 {stat.salvage}</span>
        <span className="text-red-700">驳回 {stat.killed}</span>
        <span className="text-neutral-500">未裁定 {stat.undetermined}</span>
      </div>
      <ul className="divide-y divide-neutral-100 rounded border border-neutral-200 bg-white">
        {verdicts.map((v, i) => {
          const badge = verdictBadge(v.verdict);
          return (
            <li key={i} className="px-4 py-3">
              <button onClick={() => setOpenIdx(openIdx === i ? null : i)} className="flex w-full items-center gap-3 text-left">
                <span className={`rounded px-2 py-0.5 text-xs ${TONE[badge.tone]}`}>{badge.label}</span>
                <span className="flex-1 truncate text-sm">{v.claim}</span>
                <span className="text-xs text-neutral-400">{v.survive}–{v.refute} 票</span>
              </button>
              {openIdx === i && (
                <div className="mt-2 space-y-1 text-xs text-neutral-600">
                  {v.evidence && <p>证据：{v.evidence}</p>}
                  {v.narrowVersion && <p className="text-amber-700">建议窄版：{v.narrowVersion}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
