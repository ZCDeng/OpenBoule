---
date: 2026-06-01
topic: claude-only-references-and-search-fallback
---

# 产品诚实化 + 文档输入 + 检索韧性

## Summary

三项打磨合一:(1) 在 Web 显式标注 OpenConsult 专为 Claude 设计,消除"通用 multi-LLM 平台"误解;(2) references 支持 PDF/Word 等文档输入——数字文档走轻量 JS 抽取、扫描件交给 Claude 多模态;(3) web 检索从单一 Aditly 改成可降级的 provider 抽象链,新增 anysearch 作首个备用源。

## Problem Frame

产品已强绑定 Claude(`apps/web/src/pages/Landing.tsx` 多处出现 "Claude Agent SDK"、"Claude CLI 订阅会话"、"ANTHROPIC_API_KEY",`/api/settings/runtime` 暴露 `runtime: claude-agent-sdk`),但这些技术词散落在运行时栏里,没有一处醒目声明。普通访客容易以为这是支持任意模型的通用平台,装好才发现只跑 Claude——预期落差发生在最糟的时间点。

references 当前只收纯文本:上传前端 `accept` 限定 `.txt/.md/.csv/.json/.yaml`,`FileReader` 读成字符串,后端 `body` 必须是 string(`apps/api/src/services/references.ts`,上限 256KB)。客户提供的咨询材料大量是 PDF / Word / PPT,现在根本递不进来,用户只能手动转抄。

web 检索是单点:Aditly MCP 是唯一 provider(`apps/api/src/agents/runtimes/claude-sdk.ts` 注入 `mcp__aditly__*`),设 `off` 或不可用时 researcher 降级并 fail-loud 标"未联网检索"——整个调研能力随一个外部网关一起塌。

## Key Decisions

- **Claude-only 是公开声明,不是隐藏前提。** 误解的具体形态是"以为通用平台",所以文案重点是"不支持其它模型 / 需自带 Claude 访问凭证",而非泛泛的技术介绍。这是诚实化,也顺势强化定位。
- **扫描件走 Claude 多模态,不自建 OCR 栈。** 产品已"专为 Claude 设计",图片型 PDF/图片当 document/vision 输入交给已有运行时最一致——零新增服务、不背离纯 Node 形态。代价是走 token、需在线。
- **检索做 provider 抽象链,不是单一硬编码备用。** 把 web 检索抽象成有序、可配置的 provider 链(Aditly → anysearch → …),源可换、可扩展;agent 侧工具接口保持透明,切换 provider 不引入两套工具。
- **Qveris 排除。** 查证后 Qveris 是「能力路由器」(给 agent 路由第三方 API,需 key+credits),不是搜索引擎,与 Aditly 功能不对位;anysearch(统一搜索 skill,web+垂直+批量+全文抽取)才是对位选择。

## Requirements

**Claude-only 定位声明**

R1. Landing 页显眼处(hero 或紧邻主 CTA,而非埋在运行时栏)声明:OpenConsult 专为 Claude 设计,运行需自带 Claude 订阅会话或 Anthropic API key,不支持其它模型。
R2. Settings 运行时页在已暴露的 `runtime: claude-agent-sdk` 旁补一句人类可读的 Claude-only 声明,口径与 Landing 一致。
R3. README 顶部呼应同一声明,与站点文案一致,避免渠道间口径漂移。

**文档 reference 解析**

R4. references 上传接受常见文档格式(至少 PDF / DOCX / PPTX / XLSX):前端 `accept` 放开,后端校验相应放开。
R5. 数字文档(可抽取文字)走轻量 JS 抽取得到文本,写入 references 文本内容——确定性、不耗 token,作为公共底座。
R6. 抽取结果为空或过短判定为扫描件/图片型,转交 Claude 多模态解析为文本。
R7. references 存储模型扩展:扫描件需保留原始文件以供多模态消化;workflow 启动冻结快照时,同时冻结解析后的文本(供 `buildReferenceTaskContext` 拼 prompt)。
R8. 解析 fail-loud:任一文件解析失败,明确标注该文件未解析、不静默吞掉,其余文件不受影响(沿用 Aditly off 的 fail-loud 风格)。
R9. 保留现有约束:references 仍是输入材料(映射 Skill `sources/`),不复用 artifact / submit_artifact;大小上限需从"256KB 文本"按二进制重新定阈值。

**web 检索 provider 抽象链**

R10. web 检索抽象成有序 provider 链,按优先级降级(Aditly → anysearch → …)。
R11. 某 provider 探测到 off / 超时 / 失败时,自动切下一个继续真检索,替代当前"直接标未联网"。
R12. anysearch 作首个备用 provider,其 HTTP 接口适配成与 researcher 现有检索工具一致的形态,对 agent 透明。
R13. 全链耗尽后才降级到现有 fail-loud "未联网检索" 标注。
R14. provider 链可经 env/config 配置;Qveris 不纳入本链。

## Acceptance Examples

AE1. **Covers R5, R6.** 上传文字版 PDF → JS 抽取出文本,不调用 Claude;上传扫描件 PDF → JS 抽取为空 → 自动转 Claude 多模态得到文本。

AE2. **Covers R8.** 一批 references 里某个文件解析失败 → 列表中该文件标"未解析",其余文件正常入库,整批不失败。

AE3. **Covers R11, R13.** Aditly 超时 → 自动切 anysearch,researcher 仍拿到带 URL 的真实检索结果;Aditly 与 anysearch 均不可用 → 标"未联网检索"并 fail-loud 继续。

## Scope Boundaries

**Deferred for later**
- 自托管 OCR(paddleocr / minerU):仅当出现硬离线 / 数据不出境约束时再评估。
- 并行多源检索增强(同时查多源、合并去重):属质量提升,非可用性,超出 fallback 初衷。
- Qveris 作为"第三方能力调用"通路:若将来确有此需求,作为独立特性单评。

**Outside this product's identity**
- 支持非 Claude 模型:产品定位明确单 Claude,R1–R3 正是把这一点讲清楚,而非松动它。

## Dependencies / Assumptions

- 假设咨询材料以中文为主;Claude 多模态对中文扫描件的 OCR 质量可接受——**未实测,需 plan 阶段验证**。
- 假设 anysearch 免费匿名层 / 免费 key 的配额与稳定性足以作为 fallback——需 plan 验证接入形态与配额。
- references 二进制存储:现 `body` 是文本列,扫描件原始文件的存储介质(DB bytea vs 对象存储)需 plan 定。
- Claude 多模态对大 PDF 的 token 成本与现有 agent watchdog 时限的影响需评估。

## Outstanding Questions

**Resolve before planning**
- references 二进制大小上限定多少?(文本现 256KB,PDF 可能数 MB——影响 bodyLimit、存储选型、前端提示。)

**Deferred to planning**
- anysearch 具体接入形态:直接 HTTP 调用 vs 包一层 thin MCP 对齐 `mcp__aditly__*`。
- provider 链健康探测机制:主动 ping vs 失败即切。
- 扫描件原始文件存储介质与冻结快照的具体落库方式。

## Sources / Research

- **Qveris**(qveris.ai/docs):能力路由器,暴露 MCP + REST,需 API key + credits 计费;文档示例为"天气预报 API",非 web 搜索引擎。结论:与 Aditly 不对位,排除。
- **anysearch**(github.com/anysearch-ai/anysearch-skill):统一搜索 skill,支持 general web search + 垂直检索 + 批量 + 全文抽取;API key 可选(匿名低配额 / 免费 key 高配额);Node/Python/Bash CLI,~2k stars;形态是 skill/CLI,非 MCP。结论:Aditly 功能对位,入选首个备用源。
- 代码现状:references 上传 `apps/web/src/views/ProjectInputs/ProjectReferencesPanel.tsx`、服务 `apps/api/src/services/references.ts`;Aditly 注入 `apps/api/src/agents/runtimes/claude-sdk.ts`、配置 `apps/api/src/config.ts`;Landing `apps/web/src/pages/Landing.tsx`、设置 `apps/api/src/routes/settings.ts`。
