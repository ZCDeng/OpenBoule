/**
 * SSE 客户端（U7 / KTD-14, KTD-19）。
 *
 * - **每次（重）连取新一次性 ticket**（ticket 一次性消费，原生 EventSource 自动重连会撞已消费 ticket→失败，
 *   故自管重连）。url 带 ?ticket=&lastEventId=，断点续传由服务端按 lastEventId range-scan 补发。
 * - 有界队列（默认 500）保留最近事件；指数退避重连（base→max，封顶）。
 * - 依赖注入 EventSource 工厂 + ticketProvider + scheduler，便于 node:test 不起浏览器。
 */

export interface SseEvent {
  eventId: number;
  event: string;
  data: unknown;
}

export type SseState = "connecting" | "open" | "reconnecting" | "closed";

/** 最小 EventSource 接口（注入实现，便于测试）。 */
export interface EventSourceLike {
  onopen: ((this: unknown, ev: unknown) => void) | null;
  onmessage: ((this: unknown, ev: { data: string; lastEventId?: string }) => void) | null;
  onerror: ((this: unknown, ev: unknown) => void) | null;
  addEventListener?: (type: string, listener: (ev: { data: string; lastEventId?: string; type?: string }) => void) => void;
  close(): void;
}

const NAMED_EVENTS = [
  "workflow-status-changed",
  "workflow-rerun-requested",
  "workflow-recovered",
  "phase-scaffolded",
  "phase-aggregated",
  "axes-resolved",
  "surface_request",
  "surface_response",
  "artifact-below-threshold",
  "workflow-completed",
  "agent-progress",
  "sse-warning",
] as const;

export interface SseClientDeps {
  baseUrl: string; // 形如 /api/sse/workflows/:id
  ticketProvider: () => Promise<string>;
  eventSourceFactory: (url: string) => EventSourceLike;
  onEvent: (e: SseEvent) => void;
  onStateChange?: (s: SseState) => void;
  maxQueue?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  scheduler?: (fn: () => void, ms: number) => unknown;
}

export class SseClient {
  private readonly deps: SseClientDeps;
  private readonly maxQueue: number;
  private readonly backoffBase: number;
  private readonly backoffMax: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;

  private es: EventSourceLike | null = null;
  private lastEventId = 0;
  private attempt = 0;
  private closed = false;
  private readonly queue: SseEvent[] = [];

  constructor(deps: SseClientDeps) {
    this.deps = deps;
    this.maxQueue = deps.maxQueue ?? 500;
    this.backoffBase = deps.backoffBaseMs ?? 1000;
    this.backoffMax = deps.backoffMaxMs ?? 30000;
    this.schedule = deps.scheduler ?? ((fn, ms) => setTimeout(fn, ms));
  }

  /** 最近事件（有界）。 */
  recent(): readonly SseEvent[] {
    return this.queue;
  }
  get currentLastEventId(): number {
    return this.lastEventId;
  }

  async connect(): Promise<void> {
    this.closed = false;
    await this.open();
  }

  close(): void {
    this.closed = true;
    this.es?.close();
    this.es = null;
    this.deps.onStateChange?.("closed");
  }

  private async open(): Promise<void> {
    if (this.closed) return;
    this.deps.onStateChange?.(this.attempt === 0 ? "connecting" : "reconnecting");
    let ticket: string;
    try {
      ticket = await this.deps.ticketProvider();
    } catch {
      this.scheduleReconnect();
      return;
    }
    // close() 可能在 await ticket 期间发生（如 StrictMode mount→unmount→mount）。
    // 不重新检查就会创建一个游离的 EventSource，事件被重复 push。
    if (this.closed) return;
    const url = `${this.deps.baseUrl}?ticket=${encodeURIComponent(ticket)}&lastEventId=${this.lastEventId}`;
    const es = this.deps.eventSourceFactory(url);
    this.es = es;

    es.onopen = () => {
      this.attempt = 0; // 连上即重置退避
      this.deps.onStateChange?.("open");
    };
    const handleMessage = (eventName: string, ev: { data: string; lastEventId?: string; type?: string }) => {
      let parsed: SseEvent | null = null;
      try {
        const data = JSON.parse(ev.data) as unknown;
        const eventId = ev.lastEventId ? Number(ev.lastEventId) : this.lastEventId + 1;
        parsed = { eventId, event: eventName, data };
      } catch {
        return; // 半帧/坏帧丢弃
      }
      if (parsed.eventId > this.lastEventId) this.lastEventId = parsed.eventId;
      this.push(parsed);
      this.deps.onEvent(parsed);
    };
    es.onmessage = (ev) => handleMessage("message", ev);
    for (const eventName of NAMED_EVENTS) {
      es.addEventListener?.(eventName, (ev) => handleMessage(eventName, ev));
    }
    es.onerror = () => {
      es.close();
      if (this.es === es) this.es = null;
      this.scheduleReconnect();
    };
  }

  private push(e: SseEvent): void {
    this.queue.push(e);
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.deps.onStateChange?.("reconnecting");
    const delay = Math.min(this.backoffMax, this.backoffBase * 2 ** this.attempt);
    this.attempt++;
    this.schedule(() => void this.open(), delay);
  }
}
