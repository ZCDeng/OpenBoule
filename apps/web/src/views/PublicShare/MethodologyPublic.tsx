import { MethodologyGraph } from "../MethodologyDemo/MethodologyGraph.tsx";
import { Badge } from "../../components/Brutalist.tsx";

export function MethodologyPublic() {
  return <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><h1 className="font-[var(--boule-disp)] text-4xl font-black tracking-[-0.04em]">咨询方法论 · 7 阶段创作团队</h1><Badge tone="blue">PUBLIC</Badge></div><MethodologyGraph /></div>;
}
