/**
 * 第 5 交互交付轨 opt-in 选择器（Step 4.5）。
 * 在进入 Phase 5 交付前（phase4 审校 checkpoint）由审校+角色选「要不要出交互件 + 哪种」。
 * 4 份标准交付仍是必出底座；交互件是单文件屏幕件（不进 PDF），是增量。
 * 写 checkpoint_data.interactiveTrack，engine 在 phase5 读取（具体 kind 用之，auto 按模式路由，不选不出）。
 */

import { useState } from "react";
import { useAuth } from "../stores/auth.ts";
import { Badge, Button } from "./Brutalist.tsx";

const OPTIONS = [
  { v: "none", label: "不出" },
  { v: "auto", label: "自动（按模式选）" },
  { v: "html-diagram", label: "交互架构图" },
  { v: "html", label: "交互工具" },
  { v: "html-plan", label: "可展开路线图" },
] as const;

export function InteractiveTrackPicker({ workflowId }: { workflowId: string }) {
  const api = useAuth((s) => s.api);
  const [track, setTrack] = useState("none");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function choose(v: string) {
    setBusy(true);
    setSaved(false);
    try {
      await api.json(`/api/workflows/${workflowId}/interactive-track`, { method: "POST", body: JSON.stringify({ track: v }) });
      setTrack(v);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-2 border-[var(--app-fg)] bg-[var(--boule-paper)] p-4 shadow-[4px_4px_0_var(--app-fg)]">
      <div className="boule-eyebrow">第 5 交互交付轨 · 可选</div>
      <p className="mt-1 text-sm text-[var(--text-2)]">进入交付前可加一份单文件交互件（屏幕件，不进 PDF）。4 份标准交付照常产出，交互件是增量。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <Button key={o.v} disabled={busy} variant={track === o.v ? "primary" : "secondary"} onClick={() => choose(o.v)}>
            {o.label}
          </Button>
        ))}
      </div>
      {saved && <div className="mt-3"><Badge tone="blue">已保存：{OPTIONS.find((o) => o.v === track)?.label}</Badge></div>}
    </div>
  );
}
