/**
 * Workflow store（U7）。持 SSE 连接态 + surface reducer 状态 + 最近事件，供 Run 视图/CheckpointCard 订阅。
 */

import { create } from "zustand";
import type { SseState, SseEvent } from "../lib/sse.ts";
import {
  initSurfaceState,
  applySurfaceEvent,
  pendingSurfaces,
  type SurfaceState,
  type SurfaceEvent,
  type Surface,
} from "../lib/surface.ts";

interface WorkflowState {
  connection: SseState;
  surfaces: SurfaceState;
  recentEvents: SseEvent[];
  setConnection: (s: SseState) => void;
  resetSurfaces: (resolvedDigests?: string[]) => void;
  applySurface: (ev: SurfaceEvent) => void;
  pushEvent: (ev: SseEvent) => void;
  clearEvents: () => void;
  pending: () => Surface[];
}

const MAX_RECENT = 500;

export const useWorkflow = create<WorkflowState>((set, get) => ({
  connection: "connecting",
  surfaces: initSurfaceState(),
  recentEvents: [],
  setConnection: (s) => set({ connection: s }),
  resetSurfaces: (resolvedDigests = []) => set({ surfaces: initSurfaceState(resolvedDigests) }),
  applySurface: (ev) => set({ surfaces: applySurfaceEvent(get().surfaces, ev) }),
  pushEvent: (ev) =>
    set((st) => {
      // 按 eventId 去重：重连 range-scan 补发或快速 mount/unmount 泄漏的连接会重放同一事件，
      // 重复会撞 React key（eventId+type）。eventId 是服务端单调序号，重复即同一事件。
      if (st.recentEvents.some((e) => e.eventId === ev.eventId)) return st;
      const next = [...st.recentEvents, ev];
      if (next.length > MAX_RECENT) next.splice(0, next.length - MAX_RECENT);
      return { recentEvents: next };
    }),
  clearEvents: () => set({ recentEvents: [] }),
  pending: () => pendingSurfaces(get().surfaces),
}));
