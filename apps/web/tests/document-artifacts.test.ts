import { test } from "node:test";
import assert from "node:assert/strict";
import { isHistoryVersion, latestForArtifact } from "../src/lib/document-artifacts.ts";

const artifacts = [
  { id: "a1", phase: "phase1_intake", type: "brief", version: 1 },
  { id: "a2", phase: "phase1_intake", type: "brief", version: 2 },
  { id: "b1", phase: "phase2_research", type: "brief", version: 1 },
];

test("latestForArtifact returns the highest version for the same phase/type", () => {
  assert.equal(latestForArtifact(artifacts, artifacts[0]!)?.id, "a2");
  assert.equal(latestForArtifact(artifacts, artifacts[2]!)?.id, "b1");
});

test("isHistoryVersion only marks older versions of the same logical document", () => {
  assert.equal(isHistoryVersion(artifacts, artifacts[0]!), true);
  assert.equal(isHistoryVersion(artifacts, artifacts[1]!), false);
  assert.equal(isHistoryVersion(artifacts, artifacts[2]!), false);
});
