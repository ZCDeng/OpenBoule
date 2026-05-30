/**
 * debounce 测试（U9）。autosave 静默合并 + flush + cancel（注入虚拟 scheduler）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { debounce } from "../src/lib/debounce.ts";

function virtualScheduler() {
  let pending: { cb: () => void; id: number } | null = null;
  let nextId = 1;
  return {
    sched: {
      set: (cb: () => void) => { pending = { cb, id: nextId++ }; return pending.id; },
      clear: () => { pending = null; },
    },
    fire: () => { const p = pending; pending = null; p?.cb(); },
    hasPending: () => pending !== null,
  };
}

test("多次调用只触发最后一次（合并）", () => {
  const vs = virtualScheduler();
  const calls: number[] = [];
  const d = debounce((n: number) => calls.push(n), 2000, vs.sched);
  d(1); d(2); d(3);
  assert.deepEqual(calls, []); // 还没 fire
  vs.fire();
  assert.deepEqual(calls, [3]); // 只最后一次
});

test("flush 立即用最后参数触发", () => {
  const vs = virtualScheduler();
  const calls: string[] = [];
  const d = debounce((s: string) => calls.push(s), 2000, vs.sched);
  d("a");
  d.flush();
  assert.deepEqual(calls, ["a"]);
  assert.equal(vs.hasPending(), false);
});

test("cancel 丢弃待触发，不保存", () => {
  const vs = virtualScheduler();
  const calls: number[] = [];
  const d = debounce((n: number) => calls.push(n), 2000, vs.sched);
  d(1);
  d.cancel();
  vs.fire();
  assert.deepEqual(calls, []);
});
