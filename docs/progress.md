# Boule 进度

> 更新：2026-05-31
> Plan：`docs/plans/2026-05-30-001-feat-boule-architecture-plan.md`

## 已完成（git 为准）

| 单元 | commit | 状态 | 真跑验证 |
|---|---|---|---|
| U0 Feasibility Spike | `9cca391` | ✅ | 5/5 退出条件（Agent SDK headless / 并发隔离 / 真值源快照 / 6 事件映射）。见 `spikes/RESULTS.md` |
| plan 回填 U0 发现 | `4ebac0a` | ✅ | 5 处真跑发现回填（私有 repo token 强制 / query() 命名 / 裸 key 待验 / 成本量级 / thinking_delta） |
| U1 基础设施与数据层 | `a5719b5` | ✅ | docker compose（PG16+Redis7 AOF）→ 12 表迁移 → 幂等重跑 → 连接失败优雅退出 |
| U2 真值源同步 | `8f5bc10` | ✅ | live 拉私有 repo 9 文件 + 缓存一致 + 降级 + drift + token fail-loud；13 单测 |
| U3 Agent SDK 执行器 | `05cb98d` | ✅ | claude-sdk live 生产路径；32 单测（含 runtime-contract）；messages-api 裸 key 对照挂 Open Q 13 |
| U4 工作流引擎 | `c456f51` | ✅ | 真 BullMQ+真 PG 整合：9-phase happy 全跑通 / 每 phase checkpoint 暂停 / 审批后继续 / fan-out partial（researcher 失败不阻塞）/ redo 重排 / 双 approve→409。21 新测（state 纯机 + checkpoint CAS/lease/幂等/事件 + engine 整合），全套 53 绿 |
| U5 确定性 PM 逻辑 | `47363f7` | ✅ | invariant helper（url-dedup / coverage / grep / language-gate / cost-calc）+ KTD-21 裁决核心（adjudicate 四态/顺序即正确性/弃权归一）+ config 从真值源解析（不硬编码）。23 新测（含对真实缓存 SKILL.md/editor.md 回归 + cost 真 PG），全套 76 绿 |
| U6 API 网关层 | `821779b` | ✅ | Fastify 网关 wire U2/U4/U5：自建 JWT(HS256)+scrypt 认证 / 四级 RBAC / publication+stub 护栏 / opaque 分享 token(404/410/429) / surface 写授权(editor+,external·viewer 拒) / SSE 一次性 ticket + Last-Event-ID 续传 + 重连重新鉴权。11 新测（app.inject 真 PG+Redis + 真引擎 E2E 注册→项目→workflow→逐 checkpoint 审批→完成），全套 87 绿 |
| U7 前端骨架 | `eea36c9` | ✅ | Vite+React19+Tailwind4 脚手架 + 路由(/login,/projects,/projects/:id,/workflows/:id,/methodology,/s/:token) + Zustand/React Query + lib(api 401刷新 / sse 有界队列+退避+Last-Event-ID 续传 / surface 去重) + CheckpointCard + 6 态原语。14 web 单测（注入 fetch/EventSource/scheduler）+ pnpm build 通过 + dev 冒烟 200。api 仍 87 绿 |
| U8 前端核心视图 | `d7f09ae` | ✅ | 方法论 React Flow 编排图(@xyflow/react,确定性布局)+ Run 时间线(phase 卡片/当前高亮/审批 inline+role 门控/below_threshold 徽章)+ Agent 监控(KPI/SVG 成本图/虚拟列表 job/四态裁决 tab)。补 U6: GET /:id/cost + workflow GET 带 myRole。lib/derive 5 测(phaseStatus/verdictBadge/布局/KPI)，web 19 测，build 通过，api 87 绿 |
| U9 文档工作台+预览 | `9625e03` | ✅ | 后端:单写者锁(Redis SET NX+Lua 原子续期/释放)+ lineage stale 传播(编辑→下游标 stale)+ 迁移 0001(artifacts 加 stale/input_artifact_versions)+ 路由(lock 4 端点/PUT 传播/GET stale·artifacts)。前端:TipTap 编辑器(autosave debounce 2s+锁 UI+本地兜底)/文档树(stale ⚠)/版本历史/iframe 预览(sandbox 无 same-origin)/分享面板。8 新测，api 95 + web 22 绿 |
| U10 报告渲染+签名分享 | （本次） | ✅ | 后端:renderer(零-XSS:硬拒 script/iframe/on*/javascript: + 模板插值标量+escape fail loud)+ inline-assets(SSRF/路径穿越 realpath 落 baseDir/非 file·私网/OOM stat-then-read 多层上限)+ signer(scope 403)+ share-token 撤销(nonce→Redis 撤销集→410)+ 路由(GET /s/:token/report 渲染 HTML+CSP sandbox 头 / POST revoke)。前端:ReportPublic(免登录拉 /report 进隔离 iframe)+ MethodologyPublic。16 新测(穷举 XSS 向量/穿越·私网·OOM/创建→访问→撤销→410·scope→403)，全套 api 111 + web 22 绿，build 通过 |

## 环境状态

- git 本地 repo（分支 `feat/u0-feasibility-spike`），**无 remote**（未建 GitHub origin）
- Docker：`boule-postgres`(本机端口 5442) + `boule-redis`(6389, AOF) 运行中、已迁移
- 本机 `.env`（gitignored）端口改 5442/6389 避冲突；committed `.env.example` 保持 5432/6379
- auth：claude CLI 订阅会话（SDK live 用）；`GITHUB_TOKEN` 用 `gh auth token`；无 `ANTHROPIC_API_KEY`
- 测试：`pnpm --filter @boule/api test`（node:test，零额外依赖，45 测试全绿）

## U4 两处落地偏离（plan 草拟 vs 实现，已留痕）

- **recovery CAS**：plan 草拟「in-place 推进 `attempt_number` 当判别字段」。实现改为
  **原子作废旧 attempt（leased/running→failed，guard lease 已过）当判别 + 新 attempt 号重 enqueue**。
  理由：与 worker 侧幂等 `recordAttempt`（建行模型）干净组合，免 owner 跨 worker 交接；plan 要的
  全部性质（DB 写裁单赢家 / 不重复 enqueue / attempt 推进 / recovery_reason 留痕）均保留。见
  `checkpoint.ts: recoverCAS` 注释。
- **Phase 4 serial**：3 editor 在单个 phase4 job 内顺序跑（serial 顺序 + 放行闸 + below_threshold 兜底全保留），
  plan 的「每 editor 独立 job + waitUntilFinished 链」作后续细化——phase 才是恢复单元，分 job 对可靠性无增益。
- **recoverStalled** 已实现（findOrphanAttempts + recoverCAS 单赢家 + 重 enqueue），boot 兜底 + 运行期轮询皆可调；
  真 BullMQ「服务器重启恢复」端到端用例待 U6 进程编排接好后补（当前 CAS 单赢家已在 checkpoint.test 真跑覆盖）。

## U5 落地说明

- **黑话清单严格从真值源读**：`config.parseJargonPatterns` 锚定 `roles/editor.md` filter-1 的 `grep -noE`
  清单（含 `axis|basis|cohort|...|H[1-5]\.[0-9]|Phase [0-9]`），解析不到即抛错——绝不静默兜底空表
  （空表 = language-gate 永远放行 = 静默失效）。阈值 FETCH_BUDGET/VERIFY_CAP/REFUTATIONS_REQUIRED 同样解析自 SKILL.md。
- **language-gate ↔ U4 放行闸**：`languageGate(clientText).passed===false` 即 Phase 4 放行闸 `EditorRound.languageGateFailed`
  的真实来源（U4 暂由注入 agentRunner 的 score 提供，U6 wire 时接真）。`adjudicate` 四态 + composite 是 Phase 2.5 source-verifier 裁决的真实来源。
- **本单元仅做「确定性逻辑」**：mode→axis 默认模板、dispatch matrix 这类**纯数据表**配置（plan U5 列为真值源配置）
  其消费方是 workflow 创建/fan-out 派发（U6/U7），现在解析属未测的投机代码——故 defer 到消费方接入时，
  避免造无人调用的解析器（rule 2 simplicity / rule 12 不造假）。

## U6 落地说明

- **密码用 stdlib scrypt 而非 bcrypt**（已注释）：避免 node-gyp 原生构建与 pnpm onlyBuiltDependencies/Node
  strip-only 摩擦，安全等价（memory-hard KDF）。JWT 手写 HS256（stdlib crypto，零依赖，符合 KTD-10 自建）。
- **写入收口 tripwire 按设计触发**：routes/workflows.ts 写 truth_snapshot 被 U2 write-funnel.guard 逮到 →
  已 review 并入 ALLOWLIST；同时**移除路由里伪造 snapshot 的兜底**，改为缺 snapshotProvider 即 503
  （值必须源自 createFrozenSnapshot，绝不在路由构造）。
- **引擎加 per-instance queueName**：多租户/测试隔离用；E2E 用唯一队列名避免与 U4 engine.test 并行抢 job。
- **组合根 + 生产 agentRunner 暂缓**：listen() 入口 + 真 agentRunner（role 名→role 文件映射）依赖 U5 deferred 的
  dispatch matrix，现在写属投机未测代码。U6 交付**完全测过的网关 + 引擎 wiring**，E2E inject 已等价跑通
  plan Verification 的「注册→项目→workflow→checkpoint→审批→完成」。
- **SSE 流式成功路径**走 hijack（inject 测不了会挂）——故测**鉴权/授权失败**(401/403/404) + **回放服务**
  （replayEvents 只补 id>lastEventId / authorizeSse 降权→403），覆盖 plan 续传不重投不漏投。

## U7 落地说明

- **前端「真跑」= pnpm build（tsc+vite 编译打包）+ lib 逻辑 node:test + dev 冒烟**。可测的实质逻辑（api 401
  刷新单飞 / sse 续传退避有界 / surface 去重）全部依赖注入（fetch/EventSource/scheduler），node:test 无浏览器跑过；
  组件/页面经 vite build 编译验证（esbuild）。浏览器级 E2E（点击流）留待 U8 或手动 + Playwright MCP。
- **lib 文件避开参数属性/enum**（Node strip-only 限制，与后端同纪律）：ApiError 显式字段赋值。
- **SSE 自管重连**：原生 EventSource 自动重连会撞已消费的一次性 ticket，故 SseClient 每次重连取新 ticket +
  url 带 lastEventId（服务端 range-scan 续传）。指数退避，连上即重置。
- **6 态强制**：States.tsx 集中加载/空/内容/错误(P0红顶+重试/P1黄内联/P2灰) /离线降级(SSE 重连横幅)/权限不足，
  各页复用，避免漏态。
- **方法论页为静态 phase 总览占位**：完整 React Flow 7-phase 交互编排图是 U8。

## U8 落地说明

- **可视化「真跑」= pnpm build(含 React Flow 编译) + derive 纯逻辑 node:test + 6 态覆盖**。组件展示层经
  vite build 验证；phaseStatus/verdictBadge/布局/KPI 等派生逻辑 node:test 过。
- **布局不引 ELK.js**：7+2 phase 是线性链，确定性手算（layoutPhases）即可，省一个 async/worker 依赖。
- **成本图用内联 SVG 替 Recharts/Tremor**：v1 数据点少，省重依赖；图表库待交互/数据量上来再换。
- **VerdictView 数据源未落库**：Phase 2.5 结构化裁决的 engine↔2.5 wiring 未做，VerdictView 由 props 注入（空态友好）。
  徽章用 U5 同义的代码裁决映射（verdictBadge），非 verifier 自报（KTD-21）。
- **顺带补 U6**：GET /api/workflows/:id/cost(computeCost)+ workflow GET 带 myRole（前端按 editor/viewer 显隐审批按钮）。

## U9 落地说明

- **锁用 Redis SET NX + Lua 原子 compare-and-act**（续期/释放校验 owner，防误删他人锁）；docId=artifactId
  （v1 锁版本行，逻辑文档级锁待版本聚合需求再细化）。
- **lineage stale：v1 不自动级联**——PUT 编辑只标下游 stale + 返回受影响 phase，用户确认后才重跑
  （与 OD「refresh 是显式 action」同哲学）。ANY/cast 类型推断不稳，DB 用 `IN (sql.join)` 逐参绑定。
- **报告预览职责边界**：前端只做 iframe 隔离（`sandbox="allow-scripts"` **不给** allow-same-origin，srcdoc）；
  服务端渲染 + 资源内联 + CSP 由 **U10** 提供，SharePage 现用占位 HTML 演示隔离。
- **stale 列用 boolean**（非 int 旗标）；artifacts schema 加 input_artifact_versions(jsonb)，迁移 0001 已应用。
- **重跑触发引擎 re-enqueue 暂未接**：lineage 标记 + 审计(logRerun→workflow_events)就绪，实际重跑下游
  调 engine 的 wiring 随组合根落地。TipTap 把 web 包体推到 866kB（仅警告），code-split 留待优化。

## U10 落地说明

- **零-XSS 双层**：iframe opaque sandbox 是隔离层，renderer 是渲染前硬拒层（正则删危险结构 + 模板插值标量+escape）。
- **inline-assets 仅 guard 已接入**：v1 报告是 DB artifact body（无文件资源），路由走 buildReportDocument；
  inline-assets 的 SSRF/穿越/OOM guard 独立测就绪，接入待文件型报告出现（已留痕）。
- **撤销=nonce 入 Redis 撤销集**（保留 DB 行，验证撤销→410 而非 404）；GET /s/:token/report 顶层导航加
  `Content-Security-Policy: sandbox allow-scripts` 强制 opaque-origin。
- **puppeteer/PDF v1 不实现**（plan 明示推迟）。

## 主干状态：U0–U10 全部完成 ✅

后端 111 测 + 前端 22 测全绿；docker(PG/Redis)运行；迁移 0001 应用；pnpm build 通过。

## 剩余未决 / 收尾项（非 plan 实现单元）

- **组合根**：server.ts listen() + 生产 agentRunner（role 名→role 文件映射，需 U5 deferred 的 dispatch matrix）+
  snapshotProvider 接 createFrozenSnapshot + 起 BullMQ worker。把已测的 buildApp/WorkflowEngine/真值源 wire 成可部署进程。
- **engine↔surface/2.5/lineage-rerun wiring**：checkpoint→requestSurface+emit surface 事件；Phase 2.5 结构化裁决落库；
  lineage「保存并重跑下游」调 engine re-enqueue。
- Open Q 13：messages-api 裸 key 端到端对照（需 `ANTHROPIC_API_KEY`）。
- git remote 是否建（当前无 origin，全程未 push）。
- 优化：TipTap/React Flow bundle code-split；Recharts/ELK.js 升级；langfuse（KTD-22 Deferred）。
- 未决：Open Q 13（messages-api 裸 key 端到端对照，需 `ANTHROPIC_API_KEY`）；git remote 是否建；
  组合根（server.ts listen + 生产 agentRunner role 映射，随 dispatch matrix）；
  surface 生命周期 engine↔U6 wiring（checkpoint→requestSurface+emit surface 事件，目前 checkpoint 走 workflow-status-changed）。
