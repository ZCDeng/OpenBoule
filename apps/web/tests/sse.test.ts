/**
 * SSE 客户端测试（U7 / KTD-14, KTD-19）。
 * 重点：每次重连取新 ticket + 带 lastEventId 续传；有界队列；指数退避；状态机。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SseClient, type EventSourceLike } from "../src/lib/sse.ts";

class FakeES implements EventSourceLike {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string; lastEventId?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  listeners = new Map<string, (ev: { data: string; lastEventId?: string; type?: string }) => void>();
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, listener: (ev: { data: string; lastEventId?: string; type?: string }) => void) {
    this.listeners.set(type, listener);
  }
  emit(type: string, data: unknown, lastEventId?: string) {
    this.listeners.get(type)?.({ data: JSON.stringify(data), lastEventId, type });
  }
  close() {
    this.closed = true;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(opts: { maxQueue?: number } = {}) {
  const made: FakeES[] = [];
  let ticketN = 0;
  const scheduled: { fn: () => void; ms: number }[] = [];
  const events: { eventId: number; event: string; data: unknown }[] = [];
  const states: string[] = [];
  const client = new SseClient({
    baseUrl: "/api/sse/workflows/w1",
    ticketProvider: async () => `tk${ticketN++}`,
    eventSourceFactory: (url) => {
      const es = new FakeES(url);
      made.push(es);
      return es;
    },
    onEvent: (e) => events.push({ eventId: e.eventId, event: e.event, data: e.data }),
    onStateChange: (s) => states.push(s),
    backoffBaseMs: 1000,
    backoffMaxMs: 30000,
    maxQueue: opts.maxQueue,
    scheduler: (fn, ms) => {
      scheduled.push({ fn, ms });
      return 0;
    },
  });
  return { client, made, scheduled, events, states };
}

test("首连 url 带 ticket 与 lastEventId=0；收事件后 lastEventId 跟进", async () => {
  const h = harness();
  await h.client.connect();
  await flush();
  assert.equal(h.made.length, 1);
  assert.match(h.made[0]!.url, /ticket=tk0/);
  assert.match(h.made[0]!.url, /lastEventId=0/);

  h.made[0]!.onopen?.(null);
  assert.ok(h.states.includes("open"));

  h.made[0]!.onmessage?.({ data: JSON.stringify({ phase: "p1" }), lastEventId: "7" });
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0]!.eventId, 7);
  assert.equal(h.client.currentLastEventId, 7);
});

test("具名 SSE 事件通过 addEventListener 接收并保留事件名", async () => {
  const h = harness();
  await h.client.connect();
  await flush();

  h.made[0]!.emit("agent-progress", { phase: "phase1_intake", type: "tool_use" }, "9");
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0]!.eventId, 9);
  assert.equal(h.events[0]!.event, "agent-progress");
  assert.equal(h.client.currentLastEventId, 9);
});

test("后端命名事件均已注册，避免 EventSource 静默丢弃", async () => {
  const h = harness();
  await h.client.connect();
  await flush();

  for (const [i, eventName] of ["axes-resolved", "workflow-rerun-requested", "workflow-recovered"].entries()) {
    h.made[0]!.emit(eventName, { phase: "phase1_5_axis" }, String(10 + i));
  }

  assert.deepEqual(h.events.map((e) => e.event), ["axes-resolved", "workflow-rerun-requested", "workflow-recovered"]);
  assert.equal(h.client.currentLastEventId, 12);
});

test("断线重连：新 ticket + 带上次 lastEventId 续传；退避指数增长", async () => {
  const h = harness();
  await h.client.connect();
  await flush();
  h.made[0]!.onmessage?.({ data: JSON.stringify({ i: 1 }), lastEventId: "12" });

  // 触发错误 → 安排一次重连（base=1000）
  h.made[0]!.onerror?.(null);
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.scheduled[0]!.ms, 1000);
  assert.ok(h.made[0]!.closed);

  // 执行重连 → 新 ES 带 tk1 + lastEventId=12（续传，不从 0）
  h.scheduled[0]!.fn();
  await flush();
  assert.equal(h.made.length, 2);
  assert.match(h.made[1]!.url, /ticket=tk1/);
  assert.match(h.made[1]!.url, /lastEventId=12/);

  // 第二次错误 → 退避翻倍到 2000
  h.made[1]!.onerror?.(null);
  assert.equal(h.scheduled[1]!.ms, 2000);
  assert.ok(h.states.includes("reconnecting"));
});

test("连上即重置退避：open 后再断仍从 base 起", async () => {
  const h = harness();
  await h.client.connect();
  await flush();
  h.made[0]!.onerror?.(null); // 退避 1000，attempt→1
  h.scheduled[0]!.fn();
  await flush();
  h.made[1]!.onopen?.(null); // 连上 → attempt 重置 0
  h.made[1]!.onerror?.(null);
  assert.equal(h.scheduled[1]!.ms, 1000); // 重置后又从 base
});

test("有界队列：超出 maxQueue 只保留最近 N", async () => {
  const h = harness({ maxQueue: 3 });
  await h.client.connect();
  await flush();
  for (let i = 1; i <= 5; i++) h.made[0]!.onmessage?.({ data: JSON.stringify({ i }), lastEventId: String(i) });
  const recent = h.client.recent();
  assert.equal(recent.length, 3);
  assert.deepEqual(recent.map((e) => e.eventId), [3, 4, 5]);
});

test("close 后不再重连", async () => {
  const h = harness();
  await h.client.connect();
  await flush();
  h.client.close();
  h.made[0]!.onerror?.(null);
  assert.equal(h.scheduled.length, 0); // 已 close，不安排重连
});
