/**
 * 成本趋势图（U8）。轻量内联 SVG 柱状图——避免引 Recharts/Tremor 重依赖（v1 数据点少）。
 * 完整图表库待数据量/交互需求上来再换。
 */

export interface CostBar {
  phase: string;
  costUsd: number;
}

export function CostChart({ data }: { data: CostBar[] }) {
  if (data.length === 0) return <p className="text-sm text-neutral-400">暂无成本数据</p>;
  const max = Math.max(...data.map((d) => d.costUsd), 0.0001);
  const W = 480;
  const H = 160;
  const barW = W / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="各 phase 成本">
      {data.map((d, i) => {
        const h = (d.costUsd / max) * (H - 30);
        return (
          <g key={d.phase}>
            <rect x={i * barW + 4} y={H - h - 18} width={barW - 8} height={h} className="fill-neutral-800" rx={2} />
            <text x={i * barW + barW / 2} y={H - 4} textAnchor="middle" className="fill-neutral-400 text-[8px]">
              {d.phase.replace("phase", "P").replace("_", "")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
