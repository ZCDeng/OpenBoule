/**
 * 公开方法论页（U10）。免登录只读 React Flow 编排图（静态内容，离线可用）。
 */

import { MethodologyGraph } from "../MethodologyDemo/MethodologyGraph.tsx";

export function MethodologyPublic() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl">咨询方法论 · 7 阶段创作团队</h1>
      <MethodologyGraph />
    </div>
  );
}
