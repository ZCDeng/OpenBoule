/**
 * CheckpointCard（U7 / KTD-18）。展示 phase 完成信息 + augment 选项 + 决策按钮。
 * 决策回调由 Run 视图注入（→ U6 /approve|redo|augment|reject）。viewer 只读时禁用操作。
 */

import { useState } from "react";
import type { Surface } from "../lib/surface.ts";

export type Decision = "approve" | "redo" | "augment" | "reject";

export function CheckpointCard({
  surface,
  canDecide,
  onDecide,
  busy,
}: {
  surface: Surface;
  canDecide: boolean;
  onDecide: (d: Decision) => void;
  busy?: boolean;
}) {
  const [confirming, setConfirming] = useState<Decision | null>(null);

  if (surface.status === "resolved") {
    return <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">已审批：{surface.phase}</div>;
  }
  if (surface.status === "timeout") {
    return <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">已超时：{surface.phase}（需重新发起）</div>;
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-base">待审批 · {surface.phase}</h3>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">paused</span>
      </div>
      <p className="mt-2 text-sm text-neutral-600">该 phase 已完成，等待你的决策后进入下一阶段。</p>

      {!canDecide ? (
        <p className="mt-4 text-sm text-neutral-500">你当前为只读角色，无法决策（联系 Owner 申请 Editor 权限）。</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {(["approve", "redo", "augment", "reject"] as const).map((d) => (
            <button
              key={d}
              disabled={busy}
              onClick={() => (d === "reject" ? setConfirming(d) : onDecide(d))}
              className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {{ approve: "继续", redo: "重跑", augment: "补研究", reject: "拒绝" }[d]}
            </button>
          ))}
        </div>
      )}

      {confirming === "reject" && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm">
          确认拒绝此 phase？
          <button onClick={() => { onDecide("reject"); setConfirming(null); }} className="ml-3 rounded bg-red-600 px-2 py-1 text-xs text-white">
            确认拒绝
          </button>
          <button onClick={() => setConfirming(null)} className="ml-2 text-xs text-neutral-500">取消</button>
        </div>
      )}
    </div>
  );
}
