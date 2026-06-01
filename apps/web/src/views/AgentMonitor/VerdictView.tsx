import { useState } from "react";
import { verdictBadge, type Verdict, type BadgeTone } from "../../lib/derive.ts";
import { EmptyState } from "../../components/States.tsx";
import { Badge } from "../../components/Brutalist.tsx";

export interface ClaimVerdict { claim: string; verdict: Verdict; survive: number; refute: number; narrowVersion?: string; evidence?: string; }
const TONE: Record<BadgeTone, "blue" | "orange" | "dark" | "plain"> = { green: "dark", amber: "orange", red: "orange", neutral: "plain" };

export function VerdictView({ verdicts }: { verdicts: ClaimVerdict[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (verdicts.length === 0) return <EmptyState title="暂无验证数据" hint="Phase 2.5 对抗验证完成后在此查看四态裁决。" />;
  const stat = verdicts.reduce<Record<Verdict, number>>((acc, v) => ({ ...acc, [v.verdict]: (acc[v.verdict] ?? 0) + 1 }), { confirmed: 0, salvage: 0, killed: 0, undetermined: 0 });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2"><Badge tone="dark">承重声称 {verdicts.length}</Badge><Badge>确认 {stat.confirmed}</Badge><Badge tone="orange">挽救 {stat.salvage}</Badge><Badge tone="orange">驳回 {stat.killed}</Badge><Badge>未裁定 {stat.undetermined}</Badge></div>
      <ul className="border-2 border-black shadow-[5px_5px_0_#0B0B0B]">
        {verdicts.map((v, i) => {
          const badge = verdictBadge(v.verdict);
          return <li key={i} className="border-t-2 border-black first:border-t-0 px-4 py-3"><button onClick={() => setOpenIdx(openIdx === i ? null : i)} className="flex w-full items-center gap-3 text-left"><Badge tone={TONE[badge.tone]}>{badge.label}</Badge><span className="flex-1 truncate text-sm">{v.claim}</span><span className="font-[var(--boule-mono)] text-xs text-[var(--boule-muted)]">{v.survive}–{v.refute} 票</span></button>{openIdx === i && <div className="mt-3 border-2 border-black p-3 text-xs text-[#33332e]">{v.evidence && <p>证据：{v.evidence}</p>}{v.narrowVersion && <p className="mt-1 text-[var(--boule-orange)]">建议窄版：{v.narrowVersion}</p>}</div>}</li>;
        })}
      </ul>
    </div>
  );
}
