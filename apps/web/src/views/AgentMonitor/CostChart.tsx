import { PHASE_LABELS } from "../../lib/phases.ts";

export interface CostBar { phase: string; costUsd: number; }

const PHASE_NUM = new Map(PHASE_LABELS.map((p) => [p.id, p.num]));
function phaseShort(id: string): string { const num = PHASE_NUM.get(id); return num ? `P${num}` : id; }

export function CostChart({ data }: { data: CostBar[] }) {
  if (data.length === 0) return <p className="border-2 border-dashed border-black p-4 font-[var(--boule-mono)] text-xs uppercase tracking-[0.1em] text-[var(--boule-muted)]">暂无成本数据</p>;
  const max = Math.max(...data.map((d) => d.costUsd), 0.0001);
  const W = 480;
  const H = 160;
  const barW = W / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full border-2 border-black bg-[var(--boule-paper)]" role="img" aria-label="各阶段成本">
      {data.map((d, i) => {
        const h = (d.costUsd / max) * (H - 36);
        return <g key={d.phase}><rect x={i * barW + 5} y={H - h - 22} width={Math.max(2, barW - 10)} height={h} fill="var(--boule-blue)" /><text x={i * barW + barW / 2} y={H - 7} textAnchor="middle" className="fill-black text-[8px] font-bold">{phaseShort(d.phase)}</text></g>;
      })}
    </svg>
  );
}
