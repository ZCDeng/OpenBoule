import { PHASE_LABELS } from "../../lib/phases.ts";
import { Badge } from "../../components/Brutalist.tsx";

export interface DocItem { id: string; phase: string; type: string; version?: number; status?: string; stale?: boolean; }

export function DocumentList({ docs, stalePhases, selectedId, onSelect }: { docs: DocItem[]; stalePhases: Set<string>; selectedId?: string; onSelect: (id: string) => void }) {
  const byPhase = new Map<string, DocItem[]>();
  for (const d of docs) { const list = byPhase.get(d.phase) ?? []; list.push(d); byPhase.set(d.phase, list); }
  const orderedPhases = PHASE_LABELS.map((p) => p.id).filter((p) => byPhase.has(p));
  if (docs.length === 0) return <p className="p-4 font-[var(--boule-mono)] text-xs uppercase tracking-[0.1em] text-[var(--boule-muted)]">暂无文档</p>;
  return (
    <nav className="text-sm">
      {orderedPhases.map((phase) => {
        const label = PHASE_LABELS.find((p) => p.id === phase)?.label ?? phase;
        const stale = stalePhases.has(phase);
        return <div key={phase} className="border-t-2 border-black first:border-t-0 py-3"><div className="flex items-center gap-2 px-3 font-[var(--boule-mono)] text-[10px] uppercase tracking-[0.1em] text-[var(--boule-blue)]">{label}{stale && <span className="text-[var(--boule-orange)]" title="上游已编辑，本阶段产出可能过期，需重跑">⚠</span>}</div>{byPhase.get(phase)!.map((d) => { const docStale = d.stale || stalePhases.has(d.phase); return <button key={d.id} onClick={() => onSelect(d.id)} className={`block w-full border-t border-black px-4 py-3 text-left ${d.id === selectedId ? "bg-[var(--boule-blue)] text-white" : "hover:bg-black hover:text-white"}`}><span className="block truncate font-[var(--boule-disp)] text-lg font-black tracking-[-0.03em]">{d.type}</span><span className="mt-2 flex flex-wrap items-center gap-1.5">{typeof d.version === "number" && <Badge>v{d.version}</Badge>}{d.status && <Badge>{d.status}</Badge>}{docStale && <Badge tone="orange">stale</Badge>}</span></button>; })}</div>;
      })}
    </nav>
  );
}
