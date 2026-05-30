import { PHASE_LABELS } from "../lib/phases.ts";

/**
 * 方法论演示器（U7 占位）。完整 React Flow 7-phase 可视化是 U8；这里先展示静态 phase 流，
 * 让 /methodology 路由可用、SSE/权限无关的只读页能跑通。
 */
export function MethodologyPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl">方法论 · 7 阶段创作团队</h1>
      <p className="text-sm text-neutral-500">完整交互式编排图见后续版本；此处为阶段总览。</p>
      <ol className="space-y-2">
        {PHASE_LABELS.map((p, i) => (
          <li key={p.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-xs text-white">{i}</span>
            <div>
              <div className="font-serif">{p.label}</div>
              <div className="text-xs text-neutral-500">{p.note}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
