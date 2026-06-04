import { PHASE_LABELS } from "../../lib/phases.ts";

export interface CostBar { phase: string; costUsd: number; }

const PHASE_NUM = new Map(PHASE_LABELS.map((p) => [p.id, p.num]));
function phaseShort(id: string): string { const num = PHASE_NUM.get(id); return num ? `P${num}` : id; }

export function CostChart({ data }: { data: CostBar[] }) {
  if (data.length === 0) return <p className="border-2 border-dashed border-[var(--app-fg)] p-4 font-[var(--boule-mono)] text-xs uppercase tracking-[0.1em] text-[var(--boule-muted)]">暂无成本数据</p>;
  const max = Math.max(...data.map((d) => d.costUsd), 0.0001);
  const W = 480;
  const H = 168;
  const barW = W / data.length;
  const baseY = H - 22;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full border-2 border-[var(--app-fg)] bg-[var(--boule-paper)]" role="img" aria-label={`各阶段成本，峰值 $${max.toFixed(2)}`}>
      {/* 峰值参考 + 基线，让柱高能读出实际数值 */}
      <text x={6} y={12} className="fill-[var(--boule-muted)] text-[7px] font-bold">峰值 ${max.toFixed(2)}</text>
      <line x1={0} y1={baseY} x2={W} y2={baseY} stroke="var(--app-fg)" strokeWidth={1.5} />
      {data.map((d, i) => {
        const h = (d.costUsd / max) * (H - 50);
        const barTop = baseY - h;
        const cx = i * barW + barW / 2;
        return (
          <g key={d.phase}>
            <rect x={i * barW + 5} y={barTop} width={Math.max(2, barW - 10)} height={h} fill="var(--boule-blue)" />
            <text x={cx} y={Math.max(10, barTop - 3)} textAnchor="middle" className="fill-[var(--app-fg)] text-[7px] font-bold">${d.costUsd.toFixed(2)}</text>
            <text x={cx} y={H - 7} textAnchor="middle" className="fill-[var(--app-fg)] text-[8px] font-bold">{phaseShort(d.phase)}</text>
          </g>
        );
      })}
    </svg>
  );
}
