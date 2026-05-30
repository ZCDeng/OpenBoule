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
      const next = [...st.recentEvents, ev];
      if (next.length > MAX_RECENT) next.splice(0, next.length - MAX_RECENT);
      return { recentEvents: next };
    }),
  pending: () => pendingSurfaces(get().surfaces),
}));
