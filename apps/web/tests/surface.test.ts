/**
 * surface reducer 测试（U7 / KTD-18）。重点：同 schema_digest 已 resolved 不重复弹出。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { initSurfaceState, applySurfaceEvent, pendingSurfaces } from "../src/lib/surface.ts";

test("surface_request → pending；surface_response → resolved", () => {
  let s = initSurfaceState();
  s = applySurfaceEvent(s, { type: "surface_request", id: "s1", phase: "phase1_intake", schemaDigest: "d1" });
  assert.equal(pendingSurfaces(s).length, 1);
  s = applySurfaceEvent(s, { type: "surface_response", id: "s1", schemaDigest: "d1" });
  assert.equal(pendingSurfaces(s).length, 0);
  assert.equal(s.byId["s1"]!.status, "resolved");
});

test("同 schema_digest 已 resolved → 不重复弹出", () => {
  let s = initSurfaceState();
  s = applySurfaceEvent(s, { type: "surface_request", id: "s1", phase: "p", schemaDigest: "d1" });
  s = applySurfaceEvent(s, { type: "surface_response", id: "s1", schemaDigest: "d1" });
  // 重连后又收到同 schema_digest 的新 surface_request（不同 id）→ 不再弹
  s = applySurfaceEvent(s, { type: "surface_request", id: "s2", phase: "p", schemaDigest: "d1" });
  assert.equal(pendingSurfaces(s).length, 0);
  assert.equal(s.byId["s2"], undefined);
});

test("初始 resolvedDigests（来自 GET surfaces）→ 重连不重弹已回填", () => {
  let s = initSurfaceState(["d-old"]);
  s = applySurfaceEvent(s, { type: "surface_request", id: "s9", phase: "p", schemaDigest: "d-old" });
  assert.equal(pendingSurfaces(s).length, 0);
});

test("surface_timeout 标超时", () => {
  let s = initSurfaceState();
  s = applySurfaceEvent(s, { type: "surface_request", id: "s1", phase: "p", schemaDigest: "d1" });
  s = applySurfaceEvent(s, { type: "surface_timeout", id: "s1" });
  assert.equal(s.byId["s1"]!.status, "timeout");
  assert.equal(pendingSurfaces(s).length, 0);
});

test("同 id 重复 request 幂等", () => {
  let s = initSurfaceState();
  s = applySurfaceEvent(s, { type: "surface_request", id: "s1", phase: "p", schemaDigest: "d1" });
  s = applySurfaceEvent(s, { type: "surface_request", id: "s1", phase: "p", schemaDigest: "d1" });
  assert.equal(pendingSurfaces(s).length, 1);
});
