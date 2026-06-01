import { MethodologyGraph } from "../views/MethodologyDemo/MethodologyGraph.tsx";
import { Badge, PageHeader, PageShell, Panel, PanelHeader } from "../components/Brutalist.tsx";

/** 方法论演示器（U8）。React Flow 7+2 phase 编排图，对外销售工具，离线可用。 */
export function MethodologyPage() {
  return (
    <PageShell wide>
      <PageHeader eyebrow="Nº 03 — METHOD LOOP" title="7+2 阶段创作团队">
        点击节点查看该阶段的角色与产出。整页改为首页同款硬边框、巨标题、蓝色编号的演示面板。
      </PageHeader>
      <div className="mt-8 flex flex-wrap gap-2">
        <Badge tone="blue">Phase DAG</Badge>
        <Badge>Fan-out Research</Badge>
        <Badge>Source Verdict</Badge>
        <Badge>Delivery Artifact</Badge>
      </div>
      <Panel className="mt-6">
        <PanelHeader k="GRAPH" title="方法论图谱">节点、连线与详情保留原交互，外框统一成 Boule 视觉标准。</PanelHeader>
        <div className="boule-panel-body">
          <MethodologyGraph />
        </div>
      </Panel>
    </PageShell>
  );
}
