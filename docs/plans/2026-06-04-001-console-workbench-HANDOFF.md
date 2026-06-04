# 执行交接 — 工作台内页控制台化重做

> 给下一个会话的接续状态。配套 plan：`docs/plans/2026-06-04-001-feat-console-workbench-redesign-plan.md`（单元/KTD/测试场景全在那）。

## 怎么接续

1. 切到分支 `feat/console-workbench-redesign`（plan 与本交接文件都在此分支，未提交）。
2. **先起 open-design daemon**：`pnpm tools-dev`（U1 必须，daemon 在 `127.0.0.1:7456`）。
3. `/ce-work docs/plans/2026-06-04-001-feat-console-workbench-redesign-plan.md` 重建 task list 继续。

## 单元状态（全部 pending，尚未动代码）

主链：**U1 → U2 → U3 → U6**　支链：**U4 → U5**

| 单元 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| U1 | open-design 出 Projects+共享组件控制台设计稿真值源（人工评审定稿） | — | ⛔ 卡 open-design daemon 未起 |
| U2 | 形态语义 token 分层 + 颜色双真值源收敛（`index.css`+`Brutalist.tsx`） | U1 | pending |
| U3 | 共享组件控制台化 + 清理 `index.css:90-115` legacy `!important` harmonizer | U2 | pending |
| U4 | ⌘K 命令源逻辑层 `lib/command-registry.ts` + `node:test`（**不依赖设计稿，可最先做**） | — | pending |
| U5 | ⌘K 命令栏 UI（cmdk + react-hotkeys-hook，挂 Layout） | U4（+U2/U3 样式） | pending |
| U6 | Projects 标杆页重做（据 U1 真值源对账） | U3 | pending |

> 不依赖 daemon 想先动手：**U4** 是干净的纯逻辑+测试单元，可先落地。

## 关键决策摘要（详见 plan KTD）

- 配色/字体 token **不动**，只改形态语言（圆角/柔阴影/紧凑/状态点）+ 加 ⌘K。
- ⌘K 用 **cmdk 1.1.1 + react-hotkeys-hook 5.3.2**（不自建不用 kbar）；ARIA combobox+listbox+activedescendant，焦点留 input。
- 状态点克制：蓝=进行中 / 橙=需注意 / 绿=完成 / 红=失败 / 灰=草稿；过 `lib/labels.ts`，不直出枚举码。
- **亮色优先**呼应 landing，暗色 Deferred（token 分层留接入点不实现）。
- **不引 vitest**：⌘K 可测逻辑下沉 `lib/` 用 node:test，UI 靠浏览器+屏幕阅读器实测。
- 清 legacy harmonizer 后逐页回归（tiptap/xyflow/RunTimeline 重点查）。
- 微交互归 CSS、编排归 GSAP；动手前读 `docs/plans/2026-06-02-002-feat-gsap-animation-layer-plan.md` 划界。

## Deferred（本轮不做）

其余内页精修（ProjectDetail/Workflow/Methodology/Settings/Share，token 切换后继承新形态、不破版即可）、暗色模式、⌘K 跨项目跳 workflow（无全局端点）、组件测试栈。
