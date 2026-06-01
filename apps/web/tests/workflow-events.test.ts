import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventsForPhase,
  normalizeWorkflowEvent,
  normalizeWorkflowEvents,
  surfaceEventFromSse,
} from "../src/lib/workflow-events.ts";
import type { SseEvent } from "../src/lib/sse.ts";

test("workflow event normalizer maps known events and filters thinking_delta", () => {
  const events: SseEvent[] = [
    { eventId: 1, event: "workflow-status-changed", data: { phase: "phase1_intake", status: "running" } },
    { eventId: 2, event: "agent-progress", data: { phase: "phase1_intake", type: "thinking_delta", summary: "secret" } },
    { eventId: 3, event: "agent-progress", data: { phase: "phase1_intake", type: "tool_use", summary: "调用工具 web_search" } },
  ];

  const out = normalizeWorkflowEvents(events);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.title, "工作流状态更新");
  assert.equal(out[1]!.title, "工具调用");
  assert.ok(!JSON.stringify(out).includes("secret"));
});

test("workflow event normalizer falls back for unknown events", () => {
  const out = normalizeWorkflowEvent({ eventId: 4, event: "new-event", data: { phase: "p", ok: true } });
  assert.equal(out?.event, "new-event");
  assert.equal(out?.phase, "p");
  assert.equal(out?.tone, "neutral");
  assert.match(out?.summary ?? "", /"ok":true/);
});

test("phase filtering only returns the current phase", () => {
  const items = normalizeWorkflowEvents([
    { eventId: 1, event: "agent-progress", data: { phase: "phase1_intake", type: "status", summary: "one" } },
    { eventId: 2, event: "agent-progress", data: { phase: "phase2_research", type: "status", summary: "two" } },
  ]);
  assert.deepEqual(eventsForPhase(items, "phase2_research").map((e) => e.summary), ["two"]);
});

test("surface events are converted for the reducer", () => {
  assert.deepEqual(
    surfaceEventFromSse({
      eventId: 5,
      event: "surface_request",
      data: { surfaceId: "s1", phase: "phase1_intake", schemaDigest: "phase1_intake:1" },
    }),
    { type: "surface_request", id: "s1", phase: "phase1_intake", schemaDigest: "phase1_intake:1" },
  );
  assert.deepEqual(
    surfaceEventFromSse({
      eventId: 6,
      event: "surface_response",
      data: { surfaceId: "s1", schemaDigest: "phase1_intake:1" },
    }),
    { type: "surface_response", id: "s1", schemaDigest: "phase1_intake:1" },
  );
});
