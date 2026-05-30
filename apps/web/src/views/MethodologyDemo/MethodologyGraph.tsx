/**
 * 方法论演示器（U8 / P1）。React Flow 渲染 7+2 phase 节点；线性确定性布局（不引 ELK.js，链状无需）。
 * 点击节点展开详情面板。离线完全可用（静态内容）。
 */

import { useMemo, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PhaseNode, type PhaseNodeData } from "./PhaseNode.tsx";
import { PHASE_LABELS } from "../../lib/phases.ts";
import { layoutPhases, type PhaseRunStatus } from "../../lib/derive.ts";

const nodeTypes = { phase: PhaseNode };

/** statusByPhase 可选——传入则节点按 run 状态着色（嵌进时间线时用），否则静态。 */
export function MethodologyGraph({ statusByPhase }: { statusByPhase?: Record<string, PhaseRunStatus> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const positions = useMemo(() => layoutPhases(PHASE_LABELS.map((p) => p.id), 120), []);

  const nodes: Node<PhaseNodeData>[] = useMemo(
    () =>
      PHASE_LABELS.map((p, i) => ({
        id: p.id,
        type: "phase",
        position: { x: positions[i]!.x, y: positions[i]!.y },
        data: {
          label: p.label,
          note: p.note,
          sampleOutputs: (i % 3) + 1,
          status: statusByPhase?.[p.id],
          onOpen: () => setOpenId(p.id),
        },
      })),
    [positions, statusByPhase],
  );

  const edges: Edge[] = useMemo(
    () =>
      PHASE_LABELS.slice(1).map((p, i) => ({
        id: `${PHASE_LABELS[i]!.id}-${p.id}`,
        source: PHASE_LABELS[i]!.id,
        target: p.id,
        animated: false,
      })),
    [],
  );

  const open = PHASE_LABELS.find((p) => p.id === openId);

  return (
    <div className="relative h-[600px] rounded-lg border border-neutral-200 bg-white">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      {open && (
        <aside className="absolute right-0 top-0 h-full w-72 overflow-auto border-l border-neutral-200 bg-white p-4 shadow-lg">
          <div className="flex items-start justify-between">
            <h3 className="font-serif">{open.label}</h3>
            <button onClick={() => setOpenId(null)} className="text-sm text-neutral-400">✕</button>
          </div>
          <p className="mt-2 text-sm text-neutral-600">{open.note}</p>
        </aside>
      )}
    </div>
  );
}
