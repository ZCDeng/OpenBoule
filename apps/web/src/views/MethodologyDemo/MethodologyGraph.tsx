import { useMemo, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PhaseNode, type PhaseNodeData } from "./PhaseNode.tsx";
import { PHASE_LABELS } from "../../lib/phases.ts";
import { layoutPhases, type PhaseRunStatus } from "../../lib/derive.ts";
import { Badge } from "../../components/Brutalist.tsx";
import { useTheme } from "../../stores/theme.ts";

const nodeTypes = { phase: PhaseNode };

export function MethodologyGraph({ statusByPhase }: { statusByPhase?: Record<string, PhaseRunStatus> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // xyflow 的边 stroke / Background 点色走 SVG presentation 属性，无法解析 CSS var —— 按主题取字面色。
  const inkColor = useTheme((s) => (s.resolved === "dark" ? "#e7e5dd" : "#0B0B0B"));
  const positions = useMemo(() => layoutPhases(PHASE_LABELS.map((p) => p.id), 120), []);
  const nodes: Node<PhaseNodeData>[] = useMemo(() => PHASE_LABELS.map((p, i) => ({ id: p.id, type: "phase", position: { x: positions[i]!.x, y: positions[i]!.y }, data: { label: p.label, note: p.note, status: statusByPhase?.[p.id], onOpen: () => setOpenId(p.id) } })), [positions, statusByPhase]);
  const edges: Edge[] = useMemo(() => PHASE_LABELS.slice(1).map((p, i) => ({ id: `${PHASE_LABELS[i]!.id}-${p.id}`, source: PHASE_LABELS[i]!.id, target: p.id, animated: false, style: { stroke: inkColor, strokeWidth: 2 } })), [inkColor]);
  const open = PHASE_LABELS.find((p) => p.id === openId);
  return (
    <div className="relative h-[600px] border-2 border-[var(--app-fg)] bg-[var(--boule-paper)] shadow-[6px_6px_0_var(--app-fg)]">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}>
        <Background color={inkColor} gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {open && <aside className="absolute right-0 top-0 h-full w-72 overflow-auto border-l-2 border-[var(--app-fg)] bg-[var(--boule-paper)] p-4 shadow-[-5px_0_0_var(--app-fg)]"><div className="flex items-start justify-between gap-3"><div><Badge tone="blue">阶段</Badge><h3 className="mt-3 font-[var(--boule-disp)] text-2xl font-black tracking-[-0.03em]">{open.label}</h3></div><button onClick={() => setOpenId(null)} className="border-2 border-[var(--app-fg)] px-2 py-1 font-[var(--boule-mono)] text-xs">✕</button></div><p className="mt-4 text-sm text-[var(--text-2)]">{open.note}</p></aside>}
    </div>
  );
}
