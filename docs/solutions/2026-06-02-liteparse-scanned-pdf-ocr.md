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

## 隔离与失败语义

liteparse/PDFium/Tesseract 不在 API 主流程内直接执行；扫描 PDF OCR 通过 `document-ocr.child.ts` fork 子进程运行，并受 `REFERENCE_PARSE_TIMEOUT_MS`、`BOULE_OCR_MAX_PAGES`、`BOULE_OCR_DPI` 与 Node old-space 限制约束。

判定规则：

- `text.trim()` 为空：failed / fallback。
- confidence 缺失：failed / fallback。
- confidence < `BOULE_OCR_CONFIDENCE_THRESHOLD`：failed / fallback。
- confidence 达标：`parse_status=parsed`、`parse_source=liteparse`。
- confidence 低于 `BOULE_STORE_ORIGINAL_CONFIDENCE_THRESHOLD`：保存原件供复查。

## 未完成的质量门槛

当前自动测试覆盖数字 PDF 不被 OCR 路影响，以及 confidence/fail-loud 判定。真实中文扫描件（表格、印章、低 DPI）仍需在有代表性的客户样本上做关键词命中率/CER/人工抽检评估；未达标时不要把 Claude fallback 退役。
