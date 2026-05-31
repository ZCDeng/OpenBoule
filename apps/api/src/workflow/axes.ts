/**
 * 调研轴（axis）解析与 researcher task 构建（task-threading）。
 *
 * phase1.5（轴分解）agent 产出自由文本，末尾按约定带一个 ```json 块；本模块确定性提取 axes
 * 持久化到 workflows.axes，再由 phase2 fan-out 把每个 axis 透传给对应 researcher 当具体研究问题。
 * 纯函数：无 I/O。KTD：模型做判断（分解），代码做提取/路由（verdict）。
 */

export interface AxisItem {
  axis: string;
  frame?: string;
  lanes?: string[];
}

/** 从 agent 文本末尾的 ```json 块提取 axes。容错：无块/坏 JSON/坏形状 → []（不臆造）。 */
export function parseAxes(text: string): AxisItem[] {
  if (typeof text !== "string" || text === "") return [];
  // 取最后一个 ```json ... ``` 围栏块（agent 可能先思考再给结构化结果）
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  const candidates = fences.length > 0 ? fences.map((m) => m[1]!) : [text];
  for (const raw of candidates.reverse()) {
    const parsed = tryParse(raw);
    if (parsed.length > 0) return parsed;
  }
  return [];
}

function tryParse(raw: string): AxisItem[] {
  let obj: unknown;
  try {
    obj = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  // 兼容 {axes:[...]} 与裸数组 [...]
  const arr = Array.isArray(obj) ? obj : Array.isArray((obj as { axes?: unknown })?.axes) ? (obj as { axes: unknown[] }).axes : null;
  if (!arr) return [];
  const out: AxisItem[] = [];
  for (const item of arr) {
    const axis = typeof item === "string" ? item : typeof (item as { axis?: unknown })?.axis === "string" ? (item as { axis: string }).axis : "";
    if (axis.trim() === "") continue;
    const frame = typeof (item as { frame?: unknown })?.frame === "string" ? (item as { frame: string }).frame : undefined;
    const lanes = Array.isArray((item as { lanes?: unknown })?.lanes)
      ? (item as { lanes: unknown[] }).lanes.filter((l): l is string => typeof l === "string")
      : undefined;
    out.push({ axis: axis.trim(), ...(frame ? { frame } : {}), ...(lanes && lanes.length > 0 ? { lanes } : {}) });
  }
  return out;
}

/**
 * 为第 childIndex（1-based）个 researcher 构建具体研究 task。
 * 有对应 axis → 给轴内容 + 用 web 工具检索指令；无（axes 短/空）→ 退化到通用 phase 任务（不阻塞）。
 */
export function researcherTask(axes: AxisItem[], childIndex: number, fallback: string): string {
  const axis = axes[childIndex - 1];
  if (!axis) return fallback;
  const framePart = axis.frame ? `（视角：${axis.frame}）` : "";
  const lanePart = axis.lanes && axis.lanes.length > 0 ? `\n需覆盖 lane：${axis.lanes.join("、")}。` : "";
  return (
    `就以下调研轴展开检索与分析：「${axis.axis}」${framePart}。` +
    `\n用提供的 web 搜索工具检索最新、可核验的事实（带来源链接），按 finding 粒度产出，勿凭记忆臆断。${lanePart}`
  );
}
