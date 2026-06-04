/**
 * CheckpointCard（U7 / KTD-18）——审批卡片使用首页同款 brutalist slab。
 */

import { useState } from "react";
import type { Surface } from "../lib/surface.ts";
import { phaseLabel, statusLabel } from "../lib/labels.ts";
import { Badge, Button, Panel } from "./Brutalist.tsx";

export type Decision = "approve" | "redo" | "augment" | "reject";

export function CheckpointCard({ surface, canDecide, onDecide, busy }: { surface: Surface; canDecide: boolean; onDecide: (d: Decision) => void; busy?: boolean }) {
  const [confirming, setConfirming] = useState<Decision | null>(null);

  if (surface.status === "resolved") {
    return <div className="border-2 border-[var(--app-fg)] bg-[var(--boule-blue)] p-4 font-[var(--boule-mono)] text-xs uppercase tracking-[0.1em] text-white shadow-[4px_4px_0_var(--app-fg)]">已确认：{phaseLabel(surface.phase)}</div>;
  }
  if (surface.status === "timeout") {
    return <div className="border-2 border-[var(--app-fg)] bg-[var(--boule-paper)] p-4 font-[var(--boule-mono)] text-xs uppercase tracking-[0.1em] text-[var(--boule-muted)] shadow-[4px_4px_0_var(--app-fg)]">已超时：{phaseLabel(surface.phase)}（需重新发起）</div>;
  }

  return (
    <Panel>
      <div className="flex items-center justify-between border-b-2 border-[var(--app-fg)] px-5 py-4">
        <div>
          <div className="boule-eyebrow">待确认</div>
          <h3 className="font-[var(--boule-disp)] text-2xl font-black tracking-[-0.03em]">待确认 · {phaseLabel(surface.phase)}</h3>
        </div>
        <Badge tone="orange">{statusLabel("paused_for_approval")}</Badge>
      </div>
      <div className="boule-panel-body">
        <p className="text-sm text-[var(--text-2)]">该步骤已完成，等待你的决策后进入下一步。</p>
        {!canDecide ? (
          <p className="mt-4 border-2 border-[var(--app-fg)] p-3 font-[var(--boule-mono)] text-xs uppercase tracking-[0.1em] text-[var(--boule-muted)]">你当前为只读角色，无法决策（联系项目所有者申请审校权限）。</p>
        ) : (
          <div className="mt-5 flex flex-wrap gap-2">
            {(["approve", "redo", "augment", "reject"] as const).map((d) => (
              <Button key={d} disabled={busy} variant={d === "reject" ? "danger" : d === "approve" ? "primary" : "secondary"} onClick={() => (d === "reject" ? setConfirming(d) : onDecide(d))}>
                {{ approve: "继续", redo: "重跑", augment: "补充调研", reject: "拒绝" }[d]}
              </Button>
            ))}
          </div>
        )}
        {confirming === "reject" && (
          <div className="mt-5 border-2 border-[var(--app-fg)] bg-[var(--boule-red)] p-4 text-sm text-white">
            确认拒绝此步骤？
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => { onDecide("reject"); setConfirming(null); }}>确认拒绝</Button>
              <Button variant="secondary" onClick={() => setConfirming(null)}>取消</Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
