# 2026-06-02 — liteparse 接管扫描 PDF OCR 分支

## 决策

Boule reference 解析保留两层分流：

- 数字 PDF：继续由 `pdfjs-dist` 抽文本，`parse_source=local-js`。
- Office：继续由 yauzl 读取 docx/pptx/xlsx XML，不引入 LibreOffice。
- 扫描/图像型 PDF：由 `@llamaindex/liteparse@2.0.4` 本地 Tesseract OCR 接管，成功时 `parse_source=liteparse`。

这只推翻 2026-06-01 brainstorm 中“扫描件走 Claude 多模态 OCR”的扫描件分支，不改变生成式/推理类能力仍外部模型优先的身份边界。新的边界是：确定性预处理（OCR、格式转换）属于 Boule in-identity；LLM、embedding 等生成式/推理类自托管仍 out-of-identity。

## 触发条件重定义

原先重开 OCR 栈的条件偏向“硬离线/数据不出境”。本次实际按成本、延迟与数据驻留权衡重开：

- 扫描件不再默认把客户文档 base64 发给 Anthropic。
- 默认配置 `BOULE_OCR_FALLBACK=none`：liteparse 空文本、缺 confidence、低 confidence 都 fail-loud。
- 只有显式 `BOULE_OCR_FALLBACK=claude` 时，才把 liteparse 空/低置信文件送 Claude 兜底。

旧 `BOULE_ENABLE_CLAUDE_REFERENCE_OCR=1` 仅作为兼容别名：未设置 `BOULE_OCR_FALLBACK` 时会映射到 `claude`。新部署应使用 `BOULE_OCR_FALLBACK`。

## 供应链与镜像约束

liteparse 的 Linux 原生包是 glibc (`linux-*-gnu`)，没有 musl 变体；本机容器验证还发现 arm64 原生包要求 `GLIBC_2.38`，`node:22-slim`（bookworm, glibc 2.36）不能加载，因此 API 镜像从 `node:22-alpine` 切到 `node:22-trixie-slim`。

Tesseract 语言包固定在 `tesseract-ocr/tessdata_fast` commit：

```text
87416418657359cb625c412a48b6e1d6d41c29bd
```

构建期下载并 sha256 校验：

```text
a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730  chi_sim.traineddata
7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2  eng.traineddata
```

校验失败会直接 fail build。升级 tessdata 时必须同时更新 commit 与 hash。

## 运行配置

```text
TESSDATA_PREFIX=/opt/tessdata
BOULE_OCR_LANGUAGE=chi_sim+eng
BOULE_OCR_MAX_PAGES=100
BOULE_OCR_DPI=200
BOULE_OCR_CONFIDENCE_THRESHOLD=0.55
BOULE_STORE_ORIGINAL_CONFIDENCE_THRESHOLD=0.85
BOULE_OCR_FALLBACK=none
```

`parse_source` Postgres enum 已新增 `liteparse`，迁移为 `apps/api/src/db/migrations/0008_rapid_living_mummy.sql`。

## confidence 量级（实测，勿再改）

liteparse 的 `TextItem.confidence` **实测已是 0..1**（`apps/api/scripts/ocr-calibrate.mjs`：清晰英文 OCR ≈0.95，糊掉的中文 ≈0.49），**不是** Tesseract 原生 0–100。`BOULE_OCR_CONFIDENCE_THRESHOLD`（0.55）/ `BOULE_STORE_ORIGINAL_CONFIDENCE_THRESHOLD`（0.85）就是按 0..1 设的，`averageConfidence` **直接取均值、不要除 100**。

历史教训：2026-06-03 一轮 code-review 的 3 个 agent 靠反汇编断言 confidence 是 0–100，据此加了 `/100` 归一（commit 8dd5ea8），反而把门弄成"全判失败"。实测推翻了该断言。结论：confidence 量级这类事**以实测为准**，不信反汇编推断。这条已抽成可复用的评审纪律：见 [评审结论需实测校准](conventions/review-findings-need-empirical-calibration.md)。

## 隔离与失败语义

liteparse/PDFium/Tesseract 不在 API 主流程内直接执行；扫描 PDF OCR 通过 `document-ocr.child.ts` fork 子进程运行，并受 `REFERENCE_PARSE_TIMEOUT_MS`、`BOULE_OCR_MAX_PAGES`、`BOULE_OCR_DPI` 约束。原生堆（PDFium/Tesseract，`--max-old-space-size` 管不到）由父进程 RSS 看门狗按 `BOULE_OCR_MAX_RSS_MB`（默认 1024）监控、超限 SIGKILL（仅 Linux /proc 可读时生效）；compose 另设 `mem_limit`/`pids_limit` 容器级兜底。

判定规则：

- `text.trim()` 为空：failed / fallback。
- confidence 缺失：failed / fallback。
- confidence < `BOULE_OCR_CONFIDENCE_THRESHOLD`：failed / fallback。
- confidence 达标：`parse_status=parsed`、`parse_source=liteparse`。
- confidence 低于 `BOULE_STORE_ORIGINAL_CONFIDENCE_THRESHOLD`：保存原件供复查。

## 质量门槛与校准

自动测试覆盖：数字 PDF 不被 OCR 路影响、confidence/fail-loud 判定、RSS 看门狗解析。

阈值校准用 `apps/api/scripts/ocr-calibrate.mjs <pdf目录> [labels.json]`：跑真实扫描件、打印每份 confidence(0..1)/字符量/预览，给 good/bad 标签即算出可分阈值。脚本会按本文档锁定的 commit+sha256 自动下载语言包到 `apps/api/.tessdata`（已 gitignore）。

**仍待办**：真实中文咨询扫描件（表格、印章、低 DPI）尚未在代表性样本上校准——合成样本只够确认量级与默认阈值方向（0.55 能挡住 0.49 的糊样本、放行 0.95 的清晰样本）。拿到客户样本前不要把 Claude fallback 退役。
