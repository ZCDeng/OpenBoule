import type { SseEvent } from "./sse.ts";

export type WorkflowEventTone = "neutral" | "blue" | "green" | "amber" | "red";

export interface WorkflowEventItem {
  id: string;
  eventId: number;
  event: string;
  phase?: string;
  title: string;
  summary: string;
  tone: WorkflowEventTone;
  raw: unknown;
}

export type SurfaceEventView =
  | { type: "surface_request"; id: string; phase: string; schemaDigest: string }
  | { type: "surface_response"; id: string; schemaDigest: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function truncate(value: string, max = 160): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function safeJsonSummary(value: unknown): string {
  try {
    return truncate(JSON.stringify(value));
  } catch {
    return "事件数据不可序列化";
  }
}

function eventName(ev: SseEvent): string {
  if (ev.event !== "message") return ev.event;
  return str(isRecord(ev.data) ? ev.data.event : undefined) ?? "message";
}

export function surfaceEventFromSse(ev: SseEvent): SurfaceEventView | null {
  const event = eventName(ev);
  if (!isRecord(ev.data)) return null;
  const id = str(ev.data.surfaceId) ?? str(ev.data.id);
  const schemaDigest = str(ev.data.schemaDigest);
  if (!id || !schemaDigest) return null;
  if (event === "surface_request") {
    const phase = str(ev.data.phase);
    return phase ? { type: "surface_request", id, phase, schemaDigest } : null;
  }
  if (event === "surface_response") return { type: "surface_response", id, schemaDigest };
  return null;
}

export function normalizeWorkflowEvent(ev: SseEvent): WorkflowEventItem | null {
  const event = eventName(ev);
  const data = isRecord(ev.data) ? ev.data : {};
  const phase = str(data.phase);
  const base = {
    id: `${ev.eventId}:${event}`,
    eventId: ev.eventId,
    event,
    phase,
    raw: ev.data,
  };

  switch (event) {
    case "agent-progress": {
      const type = str(data.type);
      if (type === "thinking_delta") return null;
      const summary = str(data.summary) ?? (type ? `Agent 事件：${type}` : "Agent 更新");
      const title =
        type === "tool_use"
          ? "工具调用"
          : type === "tool_result"
            ? "工具结果"
            : type === "usage"
              ? "Token 用量"
              : type === "status"
                ? "Agent 状态"
                : "Agent 工作";
      return { ...base, title, summary, tone: type === "tool_result" && data.isError === true ? "red" : "blue" };
    }
    case "workflow-status-changed":
      return { ...base, title: "工作流状态更新", summary: `状态变为 ${str(data.status) ?? "未知"}`, tone: "blue" };
    case "phase-scaffolded":
      return { ...base, title: "阶段骨架已生成", summary: phase ? `${phase} 已准备` : "阶段骨架已准备", tone: "green" };
    case "phase-aggregated":
      return { ...base, title: "阶段结果已聚合", summary: phase ? `${phase} 聚合完成` : "阶段聚合完成", tone: "green" };
    case "surface_request":
      return { ...base, title: "需要审批", summary: "阶段已暂停，等待处理 checkpoint", tone: "amber" };
    case "surface_response":
      return { ...base, title: "审批已处理", summary: "checkpoint 已关闭", tone: "green" };
    case "artifact-below-threshold":
      return { ...base, title: "产物未达阈值", summary: "系统已标记需要关注的交付物", tone: "amber" };
    case "workflow-completed":
      return { ...base, title: "工作流完成", summary: "全部阶段已完成", tone: "green" };
    case "sse-warning":
      return { ...base, title: "实时连接提示", summary: str(data.message) ?? "事件更新暂时不可用", tone: "amber" };
    default:
      return { ...base, title: event, summary: safeJsonSummary(ev.data), tone: "neutral" };
  }
}

export function normalizeWorkflowEvents(events: readonly SseEvent[]): WorkflowEventItem[] {
  return events.map(normalizeWorkflowEvent).filter((item): item is WorkflowEventItem => item !== null);
}

export function eventsForPhase(items: readonly WorkflowEventItem[], phase?: string): WorkflowEventItem[] {
  if (!phase) return [];
  return items.filter((item) => item.phase === phase);
}
