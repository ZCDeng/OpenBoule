/**
 * U1 确定性脚手架测试。phase0 产物来源——纯函数，无 I/O。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScaffoldArtifact, DEFAULT_MODE } from "../../src/workflow/scaffold.ts";

const MANIFEST = [
  "skills/SKILL.md",
  "skills/roles/editor.md",
  "skills/roles/industry-researcher.md",
];

test("happy：调研 mode + manifest → 合法 scaffold artifact", () => {
  const art = buildScaffoldArtifact("调研", MANIFEST);
  assert.equal(art.type, "scaffold");
  assert.equal(art.status, "draft");
  const parsed = JSON.parse(art.body) as { mode: string; sections: unknown[]; manifestRefs: string[] };
  assert.equal(parsed.mode, "调研");
  assert.ok(parsed.sections.length > 0);
  assert.deepEqual(parsed.manifestRefs, MANIFEST);
});

test("确定性：同输入连调两次，body 字节级相等", () => {
  const a = buildScaffoldArtifact("决策", MANIFEST);
  const b = buildScaffoldArtifact("决策", MANIFEST);
  assert.equal(a.body, b.body);
});

test("边界：mode 省略 → 用默认 mode（调研）", () => {
  for (const m of [undefined, null, ""]) {
    const art = buildScaffoldArtifact(m as string | null | undefined, MANIFEST);
    const parsed = JSON.parse(art.body) as { mode: string };
    assert.equal(parsed.mode, DEFAULT_MODE);
  }
});

test("边界：未知 mode → 回落默认骨架", () => {
  const art = buildScaffoldArtifact("不存在的mode", MANIFEST);
  const parsed = JSON.parse(art.body) as { mode: string; sections: unknown[] };
  assert.equal(parsed.mode, DEFAULT_MODE);
  assert.ok(parsed.sections.length > 0);
});

test("边界：manifest 为空 → 仍产合法骨架，manifestRefs=[]", () => {
  const art = buildScaffoldArtifact("诊断", []);
  const parsed = JSON.parse(art.body) as { sections: unknown[]; manifestRefs: string[] };
  assert.ok(parsed.sections.length > 0);
  assert.deepEqual(parsed.manifestRefs, []);
});

test("各 mode 都有非空章节", () => {
  for (const m of ["调研", "决策", "培训", "落地", "诊断"]) {
    const parsed = JSON.parse(buildScaffoldArtifact(m, MANIFEST).body) as { sections: unknown[] };
    assert.ok(parsed.sections.length >= 3, `${m} 章节应 ≥3`);
  }
});
