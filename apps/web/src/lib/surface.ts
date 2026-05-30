/**
 * Checkpoint surface 客户端 reducer（U7 / KTD-18）。纯函数，易测。
 *
 * 消费 surface_request{pending} → 渲染；respond → surface_response 关闭；surface_timeout → 超时态。
 * **同 schema_digest 已 resolved 则不重复弹出**（run 作用域去重，重连不重弹已回填的 checkpoint）。
 */

export type SurfaceStatus = "pending" | "resolved" | "timeout";

export interface Surface {
  id: string;
  phase: string;
  schemaDigest: string;
  status: SurfaceStatus;
}

export interface SurfaceState {
  byId: Record<string, Surface>;
  resolvedDigests: Set<string>;
}

export function initSurfaceState(resolvedDigests: string[] = []): SurfaceState {
  return { byId: {}, resolvedDigests: new Set(resolvedDigests) };
}

export type SurfaceEvent =
  | { type: "surface_request"; id: string; phase: string; schemaDigest: string }
  | { type: "surface_response"; id: string; schemaDigest: string }
  | { type: "surface_timeout"; id: string };

/** 应用一个 surface 事件，返回新状态（不可变）。 */
export function applySurfaceEvent(state: SurfaceState, ev: SurfaceEvent): SurfaceState {
  switch (ev.type) {
    case "surface_request": {
      // 已 resolved 的 schema_digest → 不重复弹出
      if (state.resolvedDigests.has(ev.schemaDigest)) return state;
      // 已存在同 id → 幂等
      if (state.byId[ev.id]) return state;
      return {
        ...state,
        byId: { ...state.byId, [ev.id]: { id: ev.id, phase: ev.phase, schemaDigest: ev.schemaDigest, status: "pending" } },
      };
    }
    case "surface_response": {
      const resolved = new Set(state.resolvedDigests);
      resolved.add(ev.schemaDigest);
      const existing = state.byId[ev.id];
      const byId = { ...state.byId };
      if (existing) byId[ev.id] = { ...existing, status: "resolved" };
      return { byId, resolvedDigests: resolved };
    }
    case "surface_timeout": {
      const existing = state.byId[ev.id];
      if (!existing) return state;
      return { ...state, byId: { ...state.byId, [ev.id]: { ...existing, status: "timeout" } } };
    }
  }
}

/** 当前需渲染的 pending surface 列表。 */
export function pendingSurfaces(state: SurfaceState): Surface[] {
  return Object.values(state.byId).filter((s) => s.status === "pending");
}
