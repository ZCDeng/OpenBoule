import { useMemo, useRef, useState } from "react";
import { Badge, Button, PageHeader, PageShell, Panel, PanelHeader } from "../components/Brutalist.tsx";
import { PHASE_LABELS } from "../lib/phases.ts";
import { useFadeIn } from "../hooks/useFadeIn.ts";
import { useStaggerIn } from "../hooks/useStaggerIn.ts";

const CAPABILITIES = [
  {
    no: "01",
    title: "确定性初始化",
    body: "阶段 0 秒级建立项目结构，不调模型、不耗 Token；先把目录、输入槽和交付边界固定。",
    lands: ["phase0_init", "phase1_intake"],
  },
  {
    no: "02",
    title: "多角色 AI 编排",
    body: "7+2 阶段流程：并发（多线并行）、串行质量校验、每个角色都有可追踪职责。",
    lands: ["phase1_5_axis", "phase2_research", "phase3_synthesis", "phase4_review"],
  },
  {
    no: "03",
    title: "真实联网检索",
    body: "调研阶段接入真实联网来源，输出带 URL、证据和裁决记录。",
    lands: ["phase2_research"],
  },
  {
    no: "04",
    title: "对抗验证三票",
    body: "来源核验对每条关键断言独立裁决，反驳优先，站不住的论据出局。",
    lands: ["phase2_5_verify", "phase4_review"],
  },
  {
    no: "05",
    title: "AI persona 访谈",
    body: "模拟用户访谈只作为补强输入，明确标注为模拟来源，占比受控。",
    lands: ["phase1_5_axis", "phase2_research"],
  },
  {
    no: "06",
    title: "Web-CLI 协同",
    body: "Web 端沉淀需求、材料、状态和交付；命令行端承接真实仓库与可复现执行。",
    lands: ["phase0_init", "phase5_delivery", "phase6_enrichment"],
  },
] as const;

const PHASE_META: Record<string, { key: string; mode: string; in?: string; output: string; gate?: boolean }> = {
  phase0_init: { key: "初始化 · 0 TOKEN", mode: "确定性", in: "2项输入", output: "项目结构 / 输入槽 / 数据源" },
  phase1_intake: { key: "单角色 · 接案", mode: "单角色", output: "可执行需求" },
  phase1_5_axis: { key: "单角色 · 插入校验", mode: "+2 校验", output: "3–5 个分析维度", gate: true },
  phase2_research: { key: "并发 · 4–8 多线并行", mode: "并发", in: "3项输入", output: "研究纪要 + 来源 URL" },
  phase2_5_verify: { key: "验证 · 三票", mode: "+2 校验", in: "1项输入", output: "断言裁决矩阵", gate: true },
  phase3_synthesis: { key: "单角色 · 纯推理", mode: "综合", in: "1项输入", output: "战略报告草案" },
  phase4_review: { key: "串行 · 审校 1-2-3", mode: "串行", in: "1项输入", output: "三筛后可发布稿" },
  phase5_delivery: { key: "单角色 · 签名分享", mode: "交付", in: "1项输入", output: "文档 / 分享链接 / 方法图" },
  phase6_enrichment: { key: "单角色 · 可跳过", mode: "回灌", output: "热点扫描与追加输入" },
};

export function MethodologyPage() {
  const [selected, setSelected] = useState<string>("phase2_research");
  const pageRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const selectedPhase = PHASE_LABELS.find((p) => p.id === selected) ?? PHASE_LABELS[0]!;
  const selectedCaps = useMemo(() => CAPABILITIES.filter((c) => c.lands.includes(selected as never)), [selected]);
  useFadeIn(pageRef);
  useStaggerIn(cardsRef, ".method-cap-card", { dependencies: [selected] });

  return (
    <div ref={pageRef}>
    <PageShell wide>
      <PageHeader eyebrow="Nº 03 — CAPABILITY → PIPELINE" title="能力不是卡片，是落到阶段的生产线">
        左侧是 6 个能力，右侧是 9 个阶段，中间用可点击蓝线说明“这个能力在哪一步变成输入、检索、验证和输出”。
      </PageHeader>

      <section className="method-hero mt-8" aria-label="方法论总览">
        <div>
          <div className="method-hero__kicker">OPENCONSULT · BOULE /// INPUT TO ANSWER LOOP</div>
          <h2>把用户输入压实，才允许模型输出。</h2>
          <p>每个阶段都回答两个问题：本阶段吃什么输入？产出能被谁查询、复核、继续使用？这让咨询流程从“聊天”变成可审计的流水线。</p>
        </div>
        <div className="method-hero__actions">
          <Button onClick={() => setSelected("phase1_intake")}>看输入入口</Button>
          <Button variant="secondary" onClick={() => setSelected("phase5_delivery")}>看输出查询</Button>
        </div>
      </section>

      <div className="mt-6 flex flex-wrap gap-2">
        <Badge tone="blue">6 项能力</Badge>
        <Badge>9 个阶段</Badge>
        <Badge tone="orange">输入已强化</Badge>
        <Badge>输出可检索</Badge>
      </div>

      <div className="method-map mt-7">
        <Panel className="method-map__capabilities">
          <PanelHeader k="CAPABILITIES / 六能力" title="能力落点" >点击能力卡会高亮它连接到哪些阶段。</PanelHeader>
          <div ref={cardsRef} className="method-card-list">
            {CAPABILITIES.map((cap) => {
              const active = cap.lands.includes(selected as never);
              return (
                <button key={cap.no} className={`method-cap-card ${active ? "method-cap-card--active" : ""}`} onClick={() => setSelected(cap.lands[0])}>
                  <span className="method-cap-card__no">{cap.no}</span>
                  <span className="method-cap-card__copy"><b>{cap.title}</b><small>{cap.body}</small></span>
                  <span className="method-cap-card__count">{cap.lands.length}↘</span>
                </button>
              );
            })}
          </div>
        </Panel>

        <div className="method-map__links" aria-hidden="true">
          {CAPABILITIES.map((cap, i) => (
            <div key={cap.no} className={`method-link method-link--${i + 1} ${cap.lands.includes(selected as never) ? "method-link--active" : ""}`}>
              <span />
            </div>
          ))}
        </div>

        <Panel className="method-map__pipeline">
          <PanelHeader k="PIPELINE / 九阶段" title="阶段推进" >黑色竖向是流水线推进；蓝左条是 +2 插入的质量校验。</PanelHeader>
          <ol className="method-phase-list">
            {PHASE_LABELS.map((phase, i) => {
              const meta = PHASE_META[phase.id];
              const active = phase.id === selected;
              const capCount = CAPABILITIES.filter((c) => c.lands.includes(phase.id as never)).length;
              return (
                <li key={phase.id}>
                  <button className={`method-phase ${active ? "method-phase--active" : ""} ${meta?.gate ? "method-phase--gate" : ""}`} onClick={() => setSelected(phase.id)}>
                    <span className="method-phase__num">{phase.num}</span>
                    <span className="method-phase__main"><b>{phase.label.replace(/^阶段 [^·]+ · /, "")}</b><small>{meta?.key}</small></span>
                    <span className="method-phase__io">{meta?.in ?? `${capCount}IN`}</span>
                  </button>
                  {i < PHASE_LABELS.length - 1 && <span className="method-flow-arrow" />}
                </li>
              );
            })}
          </ol>
        </Panel>
      </div>

      <div className="method-bottom mt-8">
        <Panel dark>
          <PanelHeader k="SELECTED STAGE" title={selectedPhase.label} >{selectedPhase.note}</PanelHeader>
          <div className="boule-panel-body space-y-4">
            <div className="method-stage-output">
              <span>本阶段产出</span>
              <b>{PHASE_META[selectedPhase.id]?.output}</b>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedCaps.map((cap) => <Badge key={cap.no} tone="orange">{cap.no} · {cap.title}</Badge>)}
              {selectedCaps.length === 0 && <Badge>无直接能力落点</Badge>}
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHeader k="输出检索" title="输出查询不是最后一步才出现" >所有材料、断言、版本和分享状态都应回到 Web 界面可查。</PanelHeader>
          <div className="method-query-grid boule-panel-body">
            <MiniBlock n="01" t="输入" d="需求、材料、仓库被固定进本次任务" />
            <MiniBlock n="02" t="过程" d="阶段事件 / 成本 / 来源结论实时监控" />
            <MiniBlock n="03" t="输出" d="产出 / 报告 / 公开分享可复查可追溯" />
          </div>
        </Panel>
      </div>
    </PageShell>
    </div>
  );
}

function MiniBlock({ n, t, d }: { n: string; t: string; d: string }) {
  return <div className="method-mini"><span>{n}</span><b>{t}</b><small>{d}</small></div>;
}
