# Boule 架构需求文档

> 状态：brainstorm 完成，待 `ce-plan` 拆解
> 日期：2026-05-30
> 类型：Deep / 架构 brainstorm（技术细节即主题）

## 1. 背景与问题

Boule 是一个 AI 驱动咨询流程的 Web app（前后端）。它把目前在 Claude Code CLI 里跑的 `/consulting-team` v2.4 skill（7 phase × 7 role 的 creative-team 编排）变成有界面、可视化、可协作的产品。

**真值源（single source of truth）**：`~/projects/consulting-team`

- `~/.claude/skills/consulting-team/SKILL.md`（539 行编排协议）
- `~/.claude/skills/consulting-team/roles/*.md`（7 个 role 的自包含 system prompt）
- `~/projects/consulting-team/docs/`（METHODOLOGY / PHASE_PLAYBOOK / AUGMENT_GUIDE）

Boule **读**这些文件来驱动行为，不把方法论重新编码进代码。skill 升级（v2.4 → v2.5）Boule 应跟着升，无需改业务逻辑。

### 驱动痛点（来自真实 CLI 使用，含 宇润/正治 等真实交付）

1. **向客户可视化方法论/框架** — 对外、信任/销售用途。客户不登录，但顾问要当面讲"7 phase × 7 role 怎么跑"。
2. **工作时看清进度** — 跑到哪个 phase、哪里卡住。
3. **一站式查看 + 编辑阶段性文档** — 注意是**编辑**，不只看（intake-brief / research / report / cross-cutting 等）。
4. **AI agent 进度 + 成本** — 哪些 agent 在跑、烧了多少 token、阶梯投票派了几个 verifier。
5. **报告分享麻烦** — 交付物（HTML / PDF / deck）的对外分享。

### 非显然组合后果（已确认处理）

痛点 #1 和 #5 都要"给客户看"，但客户不登录 → Boule 需要**免登录的签名只读分享/演示页**（方法论演示器 + 报告分享链接），哪怕没有客户账号体系。

## 2. 用户与目标

- **用户**：我 + 团队（顾问）。需要账号体系 + 项目共享（团队级 RBAC）。**客户不登录**。
- **核心目标**：把 CLI 里靠手工盯的咨询交付流程，变成进度/成本可见、文档可编、checkpoint 可交互、交付物可分享的 Web 工作台。

### 成功标准

1. 能从 Web 发起一次真实客户 run，看完整 7 phase 的**实时 agent 进度 + token/成本**。
2. 每个 phase checkpoint 能在 UI 做与 CLI 等价的决策：`continue / 跑 augment / skip / redo / mode / axis / frame` 调整。
3. 能在 app 内**查看并编辑**每个 phase 产出文档，编辑持久化并喂给下游 phase。
4. 能把方法论作为**交互式可视化**演示给客户（免登录），并用**签名只读链接**分享报告。
5. 确定性 PM 逻辑（normURL 去重 / coverage check / grep 自检 / 成本计算 / 语言闸门）跑在**代码**里，用一次真实历史交付（如 宇润）回归比对。
6. **真值源唯一**：改 `roles/*.md` 即改变 Boule 行为，无需改 Boule 代码。

## 3. 架构决策（本次 brainstorm 拍板）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 后端引擎 | **持久化工作流/队列（B）+ Agent SDK 执行 role（C）** | 长流程要扛重启/重试/突发并发（≤13 verifier）；确定性活儿归代码（全局规则 #5）；role 读 `roles/*.md` 保证真值源唯一 + 工具复用 |
| 用户体系 | me + team（账号 + 项目共享，团队 RBAC） | 客户不登录，不做对外多租户 |
| 对外分享 | **签名只读链接**（可过期/撤销） | 方法论演示器 + 报告都走它，免登录 |
| 方法论来源 | 读 `~/projects/consulting-team` 真值源 | 不重新编码，skill 升级即生效 |

## 4. 组件地图

```
┌─────────────────────────────────────────────────────────────┐
│ 前端 (5 个界面)                                                │
│  1 方法论演示器(可对外)  2 Run/进度时间线  3 文档工作台(看+编)  │
│  4 agent + 成本监控      5 报告/分享                           │
└───────────────┬─────────────────────────────────────────────┘
                │  REST + SSE/WebSocket(进度&成本流)
┌───────────────▼─────────────────────────────────────────────┐
│ API/网关层  — 认证 / 项目 / 团队 RBAC / 签名分享链接签发        │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│ 编排引擎 (持久化工作流)                                         │
│  phase 状态机(0→1→1.5→2→2.5→3→4→5→6)，checkpoint 处持久挂起     │
│  ├─ 并发 fan-out (Phase 2: N=4-8 researcher job)              │
│  ├─ 阶梯投票     (Phase 2.5: ≤13 verifier job, 3+3+3+2+2)     │
│  └─ 严格串行     (Phase 4: 3 editor job 顺序)                 │
└──────┬──────────────────────────┬────────────────────────────┘
       │                          │
┌──────▼──────────────┐  ┌────────▼──────────────────────────────┐
│ Role 执行器          │  │ 确定性 PM 模块 (代码，非 LLM)            │
│ Agent SDK session    │  │  normURL 去重 / FETCH_BUDGET           │
│ 读 roles/*.md 当     │  │  axis-coverage check + recovery cap    │
│ system prompt        │  │  grep 自检(字体/禁用词/版本/basis 标签) │
│ 工具: WebSearch /    │  │  成本计算 + cost transparency 矩阵     │
│ seek / agent-reach   │  │  Phase 4 语言闸门(客户版 grep 流程黑话) │
└──────┬──────────────┘  └────────────────────────────────────────┘
       │
┌──────▼───────────────────────────────────────────────────────┐
│ 持久化                                                         │
│  Postgres(结构化状态) + 对象/文件存储(产出物 md/html/pdf/assets)│
└──────────────────────────────────────────────────────────────┘
       │
┌──────▼───────────────────────────────────────────────────────┐
│ 分享服务 — 签名只读渲染(方法论演示 + 报告)，免登录              │
│ 渲染服务 — puppeteer 截图出 deck PDF；report PDF/HTML 导出      │
└──────────────────────────────────────────────────────────────┘
```

## 5. 数据模型草图（结构化状态来自 skill）

- **Project（客户）** — 名称、sources、born、团队成员/权限
- **Run** — 一次完整交付实例（一个 project 可多 run）
- **Phase** — status、checkpoint 状态(挂起/已决策)、主产出引用、grep 自检结果
- **Mode** — 5 选 1（decision/training/implementation/research/diagnosis），Phase 1.2 判定
- **Axis[]**（3-5）+ **Frame 分配** + **lanes** — Phase 1.5/2 dispatch 矩阵
- **AgentJob** — role、phase、status、tokens、cost、波次、重试
- **Finding** — basis 标签(direct/external/reasoned)、source_url、normURL、importance、source_shared_with
- **Verdict** — claim、票数(survive-refute)、四态(confirmed/salvage/killed/undetermined)、最强 refuter evidence、salvage 窄版
- **Artifact** — 路径、kind、**internal-vs-client 标记**、版本（支持编辑历史）
- **ShareLink** — token、scope(方法论/报告)、过期、撤销状态
- **CostLedger** — 按 run/phase/job 归账的 token + 金额

## 6. 关键机制（必须忠实复刻 skill 纪律）

- **Human-in-the-loop checkpoint = 核心 UX**：phase 完成 → checkpoint 卡片显示主产出 / mode / axes / 用了哪些 augment / grep 自检 / 成本透明(下一步派 N agent 预估) / 默认下一步 / augment 选项。用户动作：continue / 跑 augment / skip / redo / mode / axis / frame。
- **成本透明**：dispatch 前显示 axis×frame×lanes 矩阵 + 预估 token；运行时显示实时 spend。
- **内部语言 ≠ 客户语言闸门**：工作台区分内部工作稿(带 basis/axis/H1.1/verdict 等流程黑话)与客户交付稿；分享链接只暴露客户语言产出；代码在 Phase 4 grep 客户 HTML 命中流程黑话即退回（skill 纪律 16）。
- **四态裁决可视化**：Phase 2.5 对抗验证结果(confirmed/salvage/killed/undetermined) + salvage 窄版对照 + 驳倒附录，作为工作台一个专门视图。
- **augment 不污染主产出**：augment 结果存独立位置，主产出末尾打 `<!-- augmented by: ... -->` 标记。
- **fail loud**：agent 跳过/信息不足/矛盾全部在 UI 报出，不藏。

## 7. 范围边界

### 在本产品内
- 5 个核心界面 + 7 phase 编排 + 持久化 + 实时进度/成本 + 签名分享 + 文档编辑

### 推迟（later）
- 移动端适配
- 高级团队协作（同文档实时多人协同编辑——初版单写者锁即可）
- augment 的全量 Web 化（初版只移植 Web 可跑的判断类 augment）

### 不属于本产品身份
- 客户登录门户 / 对外多租户 SaaS
- 替代 CLI skill（skill 永远是真值源，Boule 是它的 Web 化执行+可视化层）

## 8. 依赖与假设（待 plan 阶段验证）

1. **Agent SDK headless 服务端运行** — 并发、API key、按 job 成本归账可行（Agent SDK 设计上支持，需验证 worker 池内的会话隔离）。
2. **`roles/*.md` 引用的其他 skill**（deep-industry-research / seek / agent-reach / WebSearch）在执行器环境里能否解析 — 可能需要这些 skill 安装在执行器所在环境。⚠️ 假设，需验证。
3. **augment 可移植性** — 多数 augment 是 CC skill/MCP，`deep-research` 明确是 ⚡CC-only。初版只移植判断类、无强 CC 依赖的 augment。
4. **deck PDF** — skill 用 puppeteer screenshot（非 chrome `--print-to-pdf`），需要一个 headless 渲染服务。
5. **工作流引擎选型** — Temporal（重、强保证） vs BullMQ+自建状态机（轻、够用）留给 plan 决策。
6. **文档编辑并发** — 初版单写者锁；多人实时协同推迟。

## 9. 开放问题（plan 前需定）

1. 工作流引擎：Temporal vs BullMQ+Postgres 状态机？（取决于团队规模与可靠性要求）
2. role 执行器与确定性 PM 模块的边界：哪些 skill 步骤是"判断"(给 Agent SDK)、哪些是"确定性变换"(给代码)——需逐 phase 过一遍 SKILL.md 划线。
3. 真值源同步：✅ 已确认——从 GitHub `main` 分支同步。部署时/定时拉 `skills/` 目录：
   - 入口：`skills/README.md`（关系图谱，了解整体架构）
   - 编排协议：`skills/SKILL.md` + `skills/augment-map.md` + `skills/roles/*.md`
   - 主线流程：`skills/consulting-flow/`（含 phases, checklists, delivery, project-template）
   - 原子 skill：`skills/consultant-toolkit/`（7 个 augment 定义）
   - 深研框架：`skills/deep-industry-research/`
   更新频率（deploy 时拉 / 定时同步 / webhook）待 plan 定。
4. 成本归账粒度：按 run / phase / job / augment 分别计？金额换算用哪个价目？
5. 前端技术栈与方法论演示器的可视化形态（复用 skill 里 fireworks-tech-graph 风格？）。

## 10. References

- 真值源 skill：`~/.claude/skills/consulting-team/SKILL.md` + `roles/*.md`
- 方法论文档：`~/projects/consulting-team/docs/{METHODOLOGY,PHASE_PLAYBOOK,AUGMENT_GUIDE}.md`
- augment 表：`~/.claude/skills/consulting-team/augment-map.md`
- 奠基决策 memory：`boule-foundational-decisions`
- 全局编码纪律（规则 #5 确定性归代码）：`~/.claude/CLAUDE.md`
