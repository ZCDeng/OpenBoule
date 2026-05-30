/**
 * 文档树（U9）。按 phase 分组；stale 下游 phase 显示黄 ⚠ 徽章（hover 提示受影响）。
 */

import { PHASE_LABELS } from "../../lib/phases.ts";

export interface DocItem {
  id: string;
  phase: string;
  type: string;
}

export function DocumentList({
  docs,
  stalePhases,
  selectedId,
  onSelect,
}: {
  docs: DocItem[];
  stalePhases: Set<string>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const byPhase = new Map<string, DocItem[]>();
  for (const d of docs) {
    const list = byPhase.get(d.phase) ?? [];
    list.push(d);
    byPhase.set(d.phase, list);
  }
  const orderedPhases = PHASE_LABELS.map((p) => p.id).filter((p) => byPhase.has(p));

  if (docs.length === 0) {
    return <p className="p-4 text-sm text-neutral-400">暂无文档</p>;
  }

  return (
    <nav className="divide-y divide-neutral-100 text-sm">
      {orderedPhases.map((phase) => {
        const label = PHASE_LABELS.find((p) => p.id === phase)?.label ?? phase;
        const stale = stalePhases.has(phase);
        return (
          <div key={phase} className="py-2">
            <div className="flex items-center gap-1 px-3 text-xs text-neutral-500">
              {label}
              {stale && (
                <span className="text-amber-600" title="上游已编辑，本阶段产出可能过期，需重跑">
                  ⚠
                </span>
              )}
            </div>
            {byPhase.get(phase)!.map((d) => (
              <button
                key={d.id}
                onClick={() => onSelect(d.id)}
                className={`block w-full px-4 py-1.5 text-left ${d.id === selectedId ? "bg-neutral-100" : "hover:bg-neutral-50"}`}
              >
                {d.type}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
