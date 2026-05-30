/**
 * 报告渲染零-XSS 测试（U10）。穷举注入向量 + 模板插值 fail loud。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, sanitizeReportHtml, interpolate, buildReportDocument, TemplateError } from "../../src/share/renderer.ts";

test("escapeHtml：转义 & < > \" '", () => {
  assert.equal(escapeHtml(`<a href="x" o='1'>&`), "&lt;a href=&quot;x&quot; o=&#39;1&#39;&gt;&amp;");
});

test("sanitize：删 <script>（含属性/自闭）", () => {
  assert.equal(sanitizeReportHtml(`<p>ok</p><script>alert(1)</script>`), "<p>ok</p>");
  assert.equal(sanitizeReportHtml(`<script src="x"></script>hi`), "hi");
  assert.ok(!/script/i.test(sanitizeReportHtml(`<SCRIPT TYPE="text/js">x</SCRIPT>`)));
});

test("sanitize：删 <iframe>", () => {
  assert.ok(!/iframe/i.test(sanitizeReportHtml(`<iframe src="evil"></iframe><p>x</p>`)));
});

test("sanitize：删内联事件处理器（引号/裸值）", () => {
  assert.ok(!/onclick/i.test(sanitizeReportHtml(`<a onclick="steal()">x</a>`)));
  assert.ok(!/onerror/i.test(sanitizeReportHtml(`<img src=x onerror=alert(1)>`)));
});

test("sanitize：中和 javascript: 协议", () => {
  const out = sanitizeReportHtml(`<a href="javascript:alert(1)">x</a>`);
  assert.ok(!/javascript:/i.test(out));
  assert.match(out, /blocked:/);
});

test("interpolate：标量转义", () => {
  assert.equal(interpolate("你好 {{name}}", { name: "<b>张</b>" }), "你好 &lt;b&gt;张&lt;/b&gt;");
  assert.equal(interpolate("{{n}} 条", { n: 5 }), "5 条");
});

test("interpolate：缺键 / 非标量 → 抛（fail loud，防注入）", () => {
  assert.throws(() => interpolate("{{x}}", {}), TemplateError);
  assert.throws(() => interpolate("{{o}}", { o: { a: 1 } }), TemplateError);
  assert.throws(() => interpolate("{{a}}", { a: [1, 2] }), TemplateError);
});

test("buildReportDocument：body 被 sanitize，title 被 escape", () => {
  const doc = buildReportDocument({ title: "报告 <x>", bodyHtml: `<p>正文</p><script>evil()</script>` });
  assert.match(doc, /<!doctype html>/i);
  assert.ok(!/<script>evil/.test(doc)); // 脚本被删
  assert.match(doc, /报告 &lt;x&gt;/); // 标题转义
  assert.match(doc, /<p>正文<\/p>/);
});
