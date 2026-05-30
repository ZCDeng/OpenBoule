import { MethodologyGraph } from "../views/MethodologyDemo/MethodologyGraph.tsx";

/** 方法论演示器（U8）。React Flow 7+2 phase 编排图，对外销售工具，离线可用。 */
export function MethodologyPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl">方法论 · 7 阶段创作团队</h1>
        <p className="text-sm text-neutral-500">点击节点查看该阶段的角色与产出。</p>
      </div>
      <MethodologyGraph />
    </div>
  );
}
