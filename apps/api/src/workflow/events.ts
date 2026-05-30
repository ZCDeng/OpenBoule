/**
 * 事件回放缓冲（U4 / KTD-19）。
 *
 * 持久层：`workflow_events.event_id` 全局单调 bigserial（worker 写、任意 Fastify 副本 range-scan 补发）。
 * 加速层：每 run 一个有界环形缓冲（默认 2000），SSE 断线重连先打内存；超出窗口回落 DB range-scan。
 * 落地层：best-effort ND-JSON（可注入 sink；默认 no-op，避免测试耦合文件系统）。
 *
 * SSE / HTTP 在 U6/U7 接；本模块只提供「写一条、按 Last-Event-ID 补发」的能力 + 测试。
 */

import { sql } from "drizzle-orm";
import type { DB } from "../db/client.ts";

export interface BufferedEvent {
  eventId: number;
  event: string;
  data: unknown;
}

/** ND-JSON sink（best-effort 落盘 / 转发）。默认 no-op。 */
export type EventSink = (runId: string, ev: BufferedEvent) => void;

export class EventReplayBuffer {
  private readonly capacity: number;
  private readonly sink: EventSink;
  // 每 run 一个环形（按插入顺序，event_id 单调递增）
  private readonly rings = new Map<string, BufferedEvent[]>();

  constructor(opts: { capacity?: number; sink?: EventSink } = {}) {
    this.capacity = opts.capacity ?? 2000;
    this.sink = opts.sink ?? (() => {});
  }

  /**
   * 写一条事件：先落 DB 拿单调 event_id，再入环 + best-effort sink。
   * DB 是真值源——内存环只是补发加速，进程重启后靠 DB range-scan 仍能补全。
   */
  async append(db: DB, runId: string, event: string, data: unknown): Promise<BufferedEvent> {
    const res = await db.execute(sql`
      INSERT INTO workflow_events (run_id, event, data)
      VALUES (${runId}, ${event}, ${JSON.stringify(data)}::jsonb)
      RETURNING event_id AS "eventId"
    `);
    const eventId = Number((res as unknown as { rows?: { eventId: number }[] }).rows?.[0]?.eventId);
    const ev: BufferedEvent = { eventId, event, data };
    this.push(runId, ev);
    try {
      this.sink(runId, ev);
    } catch {
      /* best-effort：sink 失败不影响主流程 */
    }
    return ev;
  }

  private push(runId: string, ev: BufferedEvent): void {
    let ring = this.rings.get(runId);
    if (!ring) {
      ring = [];
      this.rings.set(runId, ring);
    }
    ring.push(ev);
    if (ring.length > this.capacity) ring.splice(0, ring.length - this.capacity);
  }

  /** 内存里仍保留的最早 event_id（环未驱逐的下界）；run 无缓冲返回 null。 */
  earliestBuffered(runId: string): number | null {
    const ring = this.rings.get(runId);
    return ring && ring.length > 0 ? ring[0]!.eventId : null;
  }

  /**
   * 从内存补发 event_id > lastEventId 的事件。
   * 若 lastEventId 早于环内最早一条（窗口已驱逐），返回 null —— 调用方回落 DB range-scan。
   */
  replaySince(runId: string, lastEventId: number): BufferedEvent[] | null {
    const ring = this.rings.get(runId);
    if (!ring || ring.length === 0) return null;
    if (lastEventId < ring[0]!.eventId - 1) return null; // 窗口外，需 DB 补
    return ring.filter((e) => e.eventId > lastEventId);
  }
}

/** DB range-scan 补发（内存窗口外的兜底；进程重启后唯一可用路径）。 */
export async function getEventsSince(
  db: DB,
  runId: string,
  lastEventId: number,
): Promise<BufferedEvent[]> {
  const res = await db.execute(sql`
    SELECT event_id AS "eventId", event, data
      FROM workflow_events
     WHERE run_id = ${runId} AND event_id > ${lastEventId}
     ORDER BY event_id ASC
  `);
  return (res as unknown as { rows?: BufferedEvent[] }).rows ?? [];
}
