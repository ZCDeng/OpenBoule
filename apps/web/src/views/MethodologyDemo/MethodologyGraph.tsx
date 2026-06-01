import { useMemo, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PhaseNode, type PhaseNodeData } from "./PhaseNode.tsx";
import { PHASE_LABELS } from "../../lib/phases.ts";
import { layoutPhases, type PhaseRunStatus } from "../../lib/derive.ts";
import { Badge } from "../../components/Brutalist.tsx";

const nodeTypes = { phase: PhaseNode };

export function MethodologyGraph({ statusByPhase }: { statusByPhase?: Record<string, PhaseRunStatus> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const positions = useMemo(() => layoutPhases(PHASE_LABELS.map((p) => p.id), 120), []);
  const nodes: Node<PhaseNodeData>[] = useMemo(() => PHASE_LABELS.map((p, i) => ({ id: p.id, type: "phase", position: { x: positions[i]!.x, y: positions[i]!.y }, data: { label: p.label, note: p.note, sampleOutputs: (i % 3) + 1, status: statusByPhase?.[p.id], onOpen: () => setOpenId(p.id) } })), [positions, statusByPhase]);
  const edges: Edge[] = useMemo(() => PHASE_LABELS.slice(1).map((p, i) => ({ id: `${PHASE_LABELS[i]!.id}-${p.id}`, source: PHASE_LABELS[i]!.id, target: p.id, animated: false, style: { stroke: "#0B0B0B", strokeWidth: 2 } })), []);
  const open = PHASE_LABELS.find((p) => p.id === openId);
  return (
    <div className="relative h-[600px] border-2 border-black bg-[var(--boule-paper)] shadow-[6px_6px_0_#0B0B0B]">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}>
        <Background color="#0B0B0B" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {open && <aside className="absolute right-0 top-0 h-full w-72 overflow-auto border-l-2 border-black bg-[var(--boule-paper)] p-4 shadow-[-5px_0_0_#0B0B0B]"><div className="flex items-start justify-between gap-3"><div><Badge tone="blue">PHASE</Badge><h3 className="mt-3 font-[var(--boule-disp)] text-2xl font-black tracking-[-0.03em]">{open.label}</h3></div><button onClick={() => setOpenId(null)} className="border-2 border-black px-2 py-1 font-[var(--boule-mono)] text-xs">✕</button></div><p className="mt-4 text-sm text-[#33332e]">{open.note}</p></aside>}
    </div>
  );
}
