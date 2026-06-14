# Boule 跟随 consulting-team：落地 Phase 5 第 5 交互交付轨（Step 4.5）

> 状态：已落地 · 2026-06-14（后端+前端+缓存+测试全绿，见文末「落地记录」）
> 触发：consulting-team `b82fa55 feat: 集成 effective-html 第 5 交互交付轨 + filter-3b`
> 范围：仅 Step 4.5（出交互件）。Step 4.6（QR 回贴 deck）与核心纪律 19（机密不上公网）**不在本计划**。
> 前置：展示层文案已同步（commit `e06f67b`，phases.ts / Methodology / Landing / README）。

## 背景与约束

上游 designer.md Step 4.5：4 份标准交付（report / deck / 落地页 / 方法图）之外，**按需**多出
第 5 形态「交互件」——单文件自包含 HTML，让客户能点/能切/看动画，由 `effective-html`
（`html` / `html-diagram` / `html-plan`）引擎产出，按 mode 选类型，默认走 effective-html 原生暗色第二册。

Boule 是该方法论的 Web 化产品，role 真值源 = `ZCDeng/consulting-team@main`，建 workflow 时拉取冻结进
`workflows.truth_snapshot`。**所以 designer.md 的 Step 4.5 指令对新 workflow 已自动生效**（prompt 层免费跟进）。
但要让它真正产出交互件，受两条现实约束：

1. **Phase 5 是 `single` 形态**：designer 跑一次、产**一个** text artifact（`type: phase5_delivery`）。
   没有「按需多出一个交互件」的机制，也没有 mode→引擎的路由。
2. **reasoning role 被 sandbox 禁文件系统/技能工具**（agent-runner `NO_FS_TOOLS`，R-2 止空转）。
   designer 在 Boule 里**只能吐文本，不能真调 `~/.agents/skills/html` 写 `interactive/<name>.html`**。
   上游 designer.md 假设能调外部技能——Boule 必须用 task 覆盖，否则 agent 会"假装调技能"（违反 KTD-5 fail-loud）。

## 选定方案（含取舍）

| 决策点 | 选定 | 理由 |
|---|---|---|
| **产出机制** | designer agent **直接在产出里输出单文件自包含 HTML**，落为 `type:"interactive"` artifact body（不调外部技能、不写文件系统） | Boule 刻意 sandbox reasoning role（R-2）。给 designer 真 fs+技能访问 = 推翻既有安全决策。HTML-as-text 天然满足"单文件自包含"，且 Web 层已能存/渲 artifact |
| **触发** | **checkpoint opt-in**（Phase 4→5 checkpoint 由人选「要不要出 + 哪种」） | 对齐上游「PM offer / 客户要才出，不选就不出」。4 份标准交付仍是必出底座，交互件是增量 |
| **mode→kind 路由** | 代码确定性映射（KTD-5），人可在 checkpoint 覆盖 | 路由让代码答，不交模型自评。诊断/落地→`html-diagram`，决策/调研/培训→`html`，缺省→`html-plan` |
| **视觉 register** | 默认 B（effective-html 原生暗色，与正式报告对照） | 对齐上游默认；省去和 kami 暖纸张打架 |
| **自包含校验** | 确定性 lint（grep 外链 / 暗色三件套），软门 | 不靠模型自评（KTD-5）。失败标 below_threshold + emit 事件，不阻断标准交付 |
| Step 4.6 QR / 纪律19 托管 | **不做** | QR 依赖 deck 逐页硬编码结构；托管触发机密红线。自动化收益低、踩坑面大，留人工/后处理 |

**核心不变量**：Phase 5 仍是 single、PHASE_IDS 不变、状态机不动。交互件是 Phase 5 内的**第二个 artifact**，
不是新阶段——故无需前后端阶段同步（区别于 Phase 3.5）。artifacts 唯一索引 `(workflow,phase,type,version)`
已确认允许同 phase 多 type，`writeArtifactIdempotent` 冲突目标含 type，`interactive` 与 `phase5_delivery` 零冲突。

## 改动清单

### 后端（基座先行）

1. **`apps/api/src/workflow/state.ts`**（纯函数，可穷举单测）
   - 新 `export type InteractiveKind = "html" | "html-diagram" | "html-plan"`
   - 新 `defaultInteractiveKind(mode: string | null): InteractiveKind`——确定性映射（诊断/落地→html-diagram，
     决策/调研/培训→html，缺省→html-plan）
   - 新 `lintSelfContained(html: string): { ok: boolean; issues: string[] }`——纯函数：
     ⓐ 无外链 `https?://`（白名单 svg xmlns + 已知字体域）ⓑ 暗色三件套（apply-before-paint / localStorage / `html.dark`）
     ⓒ 非空 `<html`。失败收集 issues，不抛错。

2. **`apps/api/src/workflow/phases/index.ts`**
   - 新 `runInteractiveTrack(agentRunner, { workflowId, phase, kind, reportBody }): Promise<{ artifact: PhaseArtifact }>`
   - 第二次 designer 调用，task = kind 专属指令 + **明确告知"你无 fs/技能访问，直接输出单文件自包含 HTML，
     内容仅来自定稿 report、不新增方案/不改数字"**（覆盖上游"调外部技能"假设）
   - 返回 `{ type: "interactive", body: html, status: "draft" }`

3. **`apps/api/src/workflow/engine.ts`**
   - `processSingle`（phase5_delivery 分支）写完标准 artifact 后：读 `workflows.checkpoint_data->>'interactiveTrack'`，
     非空则 `runInteractiveTrack` → 写第二 artifact（`type:"interactive"`，distinct 冲突目标，安全）
   - 对 interactive body 跑 `lintSelfContained`：失败 → artifact status 标 `below_threshold` + `emit("interactive-not-self-contained", {issues})`
   - 失败不阻断标准交付（软门）

4. **`apps/api/src/services/agent-runner.ts`**
   - `mapRoleToFile` 已把 phase5_delivery→designer，无需改映射
   - 交互件调用的 task-threading：把 kind 专属指令拼进 task（类比 reviewer 的视角透传）

5. **opt-in 存储**：复用 `workflows.checkpoint_data`（jsonb，**免迁移**）。
   形如 `{ interactiveTrack: "html-diagram" | null }`。Phase 5 checkpoint 决策时写入。

### 前端

6. **Phase 5 checkpoint UI**（approvals 决策流）：在 Phase 4→5 放行 checkpoint offer
   「要不要出第 5 交互件 + 哪种（默认按 mode 预选）」→ 写 `checkpoint_data.interactiveTrack`。
   approvals 路由接受该字段。

7. **Workspace / DocumentList**：渲染 `type:"interactive"` artifact——
   「在屏幕打开」（`<iframe srcdoc>` 或新窗口）+ badge「交互件 · 不进 PDF」。复用既有 artifact 列表泛型。

8. 展示层文案 — **已完成**（commit `e06f67b`）。

### 真值源

9. **`skills-cache/skills/roles/designer.md`** 当前 stale（无 Step 4.5）。从上游 main 刷新，
   让本地降级兜底 + 任何快照测试与线上一致。（新 workflow 已直接拉上游 main，不依赖此缓存。）

## 测试

- `state.test.ts`：`defaultInteractiveKind` 各 mode 映射；`lintSelfContained` 命中外链 / 缺暗色三件套 / 通过三类。
- `phases.test.ts`：`runInteractiveTrack` 产 `interactive` artifact；未 opt-in 不调用。
- `engine` e2e：phase5 opt-in → 写 2 artifact（phase5_delivery + interactive）零冲突；lint 失败标 below_threshold + 发事件。
- 测试测意图（KTD-9）：断言"opt-in 才出第二件""lint 软门不阻断标准交付"，不耦合 HTML 字符串细节。

## 风险

- **单次文本吐大 HTML 的质量/token 风险**：designer 是 reasoning role、回合少。缓解：交互件调用单独放宽 output 预算；
  lint 软门兜底；坏产出标 below_threshold 不污染标准交付。
- **agent 假装调技能**：上游 designer.md 指令调 `~/.agents/skills/html`，Boule 不可达。
  必须靠 task 显式覆盖为"直接输出 HTML"，否则 agent 产出会引用一个没跑的技能（fail-loud 违例）。
- **mode 缺失**：`workflows.mode` 可空 → `defaultInteractiveKind(null)` 落 `html-plan` 兜底，人可在 checkpoint 改。

## 验证链

后端纯函数单测 → phases/engine 集成测 → `pnpm -C apps/api test` 全绿 → web build + tsc 两端干净 →
本地起 workflow 跑到 Phase 5、opt-in 出交互件、Workspace 屏幕打开肉眼验图 → 文案/数字零残留扫描。

## 开放决策（执行前可拍板）

1. **designer 复用 vs 专用 role**：本计划用 designer + task 覆盖。若交互件质量不稳，可后续拆
   Boule 专用 `interactive-designer.md`（不回灌上游，属 Boule 本地角色）。
2. **lint 严格度**：暗色三件套是否设为硬门（缺则不出）还是软门（标记仍出）。本计划取软门。

## 落地记录（2026-06-14）

按计划全量落地，两个开放决策都按推荐选：① designer 复用 + task 覆盖（未拆专用 role）；② lint 软门。

**后端**
- `state.ts`：`InteractiveKind` / `defaultInteractiveKind(mode)` / `lintSelfContained(html)` 三纯函数（确定性路由 + 自包含校验）。
- `phases/index.ts`：`runInteractiveTrack`——第二次 designer 调用，role 用 `interactive-<kind>` 前缀，task 透传定稿 + kind 简报。
- `agent-runner.ts`：`mapRoleToFile` 加 `interactive-*`→designer；运行时注入「无 fs/技能，直接吐单文件 HTML」覆盖（KTD-5）。
- `engine.ts`：`processSingle` phase5 分支后挂 `maybeRunInteractive`——读 `checkpoint_data.interactiveTrack`，opt-in 才出；
  写 `type:"interactive"` artifact（唯一索引含 type，与 phase5_delivery 零冲突）；lint 失败标 below_threshold + emit 事件；失败不阻断标准交付。
- `routes/approvals.ts`：`POST /api/workflows/:id/interactive-track`（editor+）写 checkpoint_data，jsonb_set 合并 / none 清除。

**前端**
- `InteractiveTrackPicker.tsx`：phase4 审校暂停且可决策时显示，5 选项（不出/自动/三 kind）写 opt-in。
- `Workspace.tsx`：`InteractivePreview`——interactive 件用 iframe `sandbox=allow-scripts` 屏幕预览 + 新窗口打开（Blob URL），不走文本 Editor。
- `DocumentList.tsx`：interactive 友好名「交互件」+「不进 PDF」橙标。
- `workflow-events.ts`：`interactive-delivered`/`-not-self-contained`/`-failed` 三事件友好文案（不外泄事件码）。

**真值源**：`skills-cache/` 从上游 main（e4df3d3）刷新 9 文件 + 重算 digest 写一致 meta（消除 stale）。

**验证**：API 226 pass / 0 fail / 2 skip（live-SDK 无凭证）+ tsc 干净；web 54 pass + build 绿 + tsc 干净。
新增测试：state 纯函数 4 例、phases runInteractiveTrack 3 例、engine opt-in 双 artifact 端到端 1 例、route 鉴权/设/清/非法 1 例。

**未做（按计划范围外）**：Step 4.6 QR 回贴 deck、核心纪律 19 公网托管红线（运营纪律，留引擎将来托管客户交付物时做）。
