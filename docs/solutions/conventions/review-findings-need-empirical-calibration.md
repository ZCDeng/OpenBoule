---
module: process/code-review
tags: [code-review, empirical-verification, multi-agent, calibration, scale-units]
problem_type: convention
date: 2026-06-03
status: active
---

# 评审结论可能自信地错：标度/单位类断言要实测，评审建议的修复要先校准再信

## 背景

一轮 10-persona `ce-code-review` 审 liteparse 扫描件 OCR 实现时，三个独立 reviewer（correctness / adversarial / testing）一致判了一个 **P0**：liteparse 的 `TextItem.confidence` 是 Tesseract 原生 0–100，而代码却拿它跟 0..1 阈值（0.55/0.85）比较，所以"门从不触发、坏 OCR 静默标 parsed"。其中 correctness 还附了反汇编证据——二进制符号里有 Tesseract 的 `Confidence()`、`lib.js` 里没有 `/100`、disassembly 里没有 `divss`。

据此加了 `/100` 归一（commit `8dd5ea8`）。这个"修复"**把门弄反了**：真实置信度本就是 0..1，一份 0.95 的好扫描件被砸成 0.0095，远低于 0.55 → 全部判失败。

跑校准脚本（`apps/api/scripts/ocr-calibrate.mjs`）拿真实样本一测才发现真相：清晰英文 OCR 的 confidence ≈ **0.95**，糊掉的中文 ≈ **0.49**——**本来就是 0..1**。三个 agent 的反汇编断言是错的（归一发生在 napi/Rust 层，他们只看了 `lib.js`）。撤销 `/100` 后门恢复正常。

## 纪律

1. **标度/单位类断言以实测为准，不信反汇编/静态推断。** "这个字段是 0–100 还是 0..1"、"这个时间戳是秒还是毫秒"、"这个尺寸是字节还是 KB"——这类问题跑一行真实数据就有答案，别靠读二进制/猜文档下结论。

2. **评审建议的修复，落地前先用真实数据校准——尤其当它涉及标度、单位、或外部库的运行期行为时。** 评审能定位"这里可疑"，但"改成什么"如果依赖某个未实测的假设，那这个修复本身就是新 bug 的温床。改完先测，别改完就信。

3. **多 agent 一致 ≠ 正确。** 共识不是证据。三个 reviewer 撞同一结论可能只是因为他们用了同一种（错的）推断方法（这里：都去读 `lib.js`/反汇编，都没跑真实样本）。一致只提高"值得查"的优先级，不提高"是对的"的概率。

落地规则：**评审 P0/P1 修复若涉及标度、单位、或外部库行为，合并前必须先跑真实样本校准（有校准脚本就跑脚本），再决定改法。**

## 为什么重要

这次的代价是：一个本来正确的实现，被一个自信的错误评审 + 据其所做的修复，改成了"全判失败"——而且 commit 已经 push 到 main。是后续做 #2 校准时数据对不上才逮回来。如果当时把"实测校准"排在"信任评审 P0"之前，这个来回根本不会发生。

"实测优先"在本仓库不是头一回：参考 [reference OCR spike gate](../2026-06-01-reference-ocr-spike.md)——上线前必须跑 5–10 份真实扫描件实测，同源直觉。它已经够独立、够跨领域，值得作为评审纪律固化下来。

## 适用场景

- 任何评审 finding 断言"某字段/参数的标度、单位、范围、编码"，而该断言没有附"我跑了真实数据"。
- 任何评审建议的修复依赖一个未实测的假设（外部库返回什么、某 API 的语义、某默认值的含义）。
- 多个 reviewer/agent 给出一致结论，但都基于同一种间接推断（读源码、反汇编、读文档），没人跑过真实输入。

不适用：纯结构性/风格类 finding（命名、重复、死代码），这些不依赖运行期事实，肉眼可判。

## 示例

**反汇编推断（错）→ 实测（对）：**

```
# 评审 P0（三个 agent 一致）：confidence 是 Tesseract 原生 0–100
#   证据：二进制符号 + lib.js 无 /100 + disassembly 无 divss
# 据此修复：averageConfidence 里 / 100   → commit 8dd5ea8 → 门全判失败

# 实测（apps/api/scripts/ocr-calibrate.mjs，真实样本）：
#   清晰英文 OCR  conf ≈ 0.95
#   糊掉的中文    conf ≈ 0.49
# 结论：confidence 本就是 0..1。撤销 /100，阈值 0.55/0.85 对 0..1 合理。
```

具体案例与 liteparse confidence 量级的最终结论见 [liteparse 扫描件 OCR](../2026-06-02-liteparse-scanned-pdf-ocr.md) 的「confidence 量级（实测，勿再改）」段。

佐证代码：`apps/api/scripts/ocr-calibrate.mjs`（校准脚本）、`apps/api/src/services/document-ocr.child.ts`（`averageConfidence`）、commit `8dd5ea8`（误修复）/ 后续撤销。
