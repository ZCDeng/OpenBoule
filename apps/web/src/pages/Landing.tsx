/**
 * 公开落地页（U-Landing）· 野性现代 / Brutalist neo-grotesque。
 * 视觉真值源：_design/landing-brutalist-demo.html（用户已批准）。
 * 设计语言：电光蓝 #1A18EE 单一 accent、近黑 #0B0B0B、骨白 #F1F0EB、原始 2px 黑边无圆角、
 * 超大粗体 grotesque、非对称网格、巨号编号、黑色跑马灯。不引外部字体/CDN，字体栈照搬 demo。
 * 登录 slab（Nº 00）内联复用 Login 同款真实逻辑（useAuth / api.json / setSession / ErrorBanner）。
 */

import { useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth.ts";
import { ApiError } from "../lib/api.ts";
import { ErrorBanner } from "../components/States.tsx";
import { PHASE_LABELS } from "../lib/phases.ts";

/* ── 配色 / 字体栈（照搬 demo 的 :root） ── */
const PAPER = "#F1F0EB";
const INK = "#0B0B0B";
const BLUE = "#1A18EE";
const CLAUDE_ORANGE = "#D97757";
const LINE = "#0B0B0B";
const MUT = "#6A6A63";
const DISP = '"Helvetica Neue","Arial Black","PingFang SC","Source Han Sans SC",sans-serif';
const BODY = '-apple-system,"PingFang SC","Source Han Sans SC","Segoe UI",sans-serif';
const MONO = '"SF Mono","JetBrains Mono",ui-monospace,"Menlo",monospace';

const GITHUB = "https://github.com/ZCDeng/OpenBoule";

/* ── 复用样式片段 ── */
const monoMeta: CSSProperties = {
  fontFamily: MONO,
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

/* Nº 01 能力矩阵（demo CAPABILITIES，4 列等权）。 */
const CAPABILITIES: { no: string; title: string; body: string }[] = [
  { no: "01", title: "确定性初始化", body: "阶段 0 秒级建立项目结构与目录，不调模型、不耗 Token。该用代码答的判断，绝不空转 AI。" },
  { no: "02", title: "多角色 AI 编排", body: "调研 / 综合 / 审校 / 设计按 7+2 阶段流程分工，并发（多线并行）、串行质量校验，合议交付。" },
  { no: "03", title: "真实联网检索", body: "调研接 Aditly 真检索：安思派深度搜索、博查实时信息、Jina 静态提取、Reach 动态抓取。带来源 URL 落进报告，不靠模型记忆编造，可超训练截止时点。" },
  { no: "04", title: "对抗验证三票", body: "来源核验对每条断言独立三票裁决，反驳优先。站不住的论据当场出局，不让似是而非过关。" },
  { no: "05", title: "AI 用户访谈", body: "atypica-research 生成 3–5 个 AI 用户深度访谈，抽取用户痛点与决策动机。明确标注为模拟来源，占比 ≤20%，诊断模式禁用。" },
];

/* Nº 02 角色编队（demo CREW，7 个真角色 + 第 8 张黑色扩展卡）。 */
const ROLES: { rid: string; name: string; en: string; body: string; dark?: boolean }[] = [
  { rid: "R1", name: "行业研究员", en: "industry-researcher", body: "接联网工具按维度真检索，带来源 URL 落进报告。阶段 2 并发（多线并行）。" },
  { rid: "R2", name: "对抗声称验证", en: "source-verifier · v2.4", body: "对每条断言独立三票裁决，反驳优先。站不住的论据当场出局。" },
  { rid: "R3", name: "战略顾问", en: "strategy-advisor", body: "把验证过的发现合成报告，阶段 3 出结构化结论与建议。" },
  { rid: "R4", name: "审稿编辑", en: "editor", body: "阶段 4 串行三筛 + 语言质量校验，代码裁决放行，不靠模型自评。" },
  { rid: "R5", name: "设计师", en: "designer", body: "阶段 5 把报告排版交付，生成可分享的文档与方法论图。" },
  { rid: "R6", name: "市场扫描员", en: "market-scanner", body: "阶段 6 增益，扫描热点与新增信号，回灌可追加的分析维度。" },
  { rid: "R7", name: "信息架构师", en: "information-architect", body: "梳理目录与产物结构，为后续阶段提供可追溯的组织框架。" },
  { rid: "+N", name: "下一个角色", en: "your-role.md", body: "加一份角色提示词就多一种专长。引擎自动接管编排。", dark: true },
];

/* Nº 03 运行时三栏（demo RUNTIME）。 */
const RUNTIME: { rk: string; title: string; body: string; events?: string[] }[] = [
  { rk: "认证 · AUTH", title: "CLI 会话 或 API key", body: "没配 API key 时走 Claude CLI 订阅会话，配了就走 key。引擎读 init 的 apiKeySource 自动切换，零改码。" },
  {
    rk: "事件流 · STREAM",
    title: "SDK 流归一成可审计事件",
    body: "逐条 SDK 消息归一，前端实时看到 AI 状态、工具调用与 Token 用量，不展示模型思考过程。",
    events: ["状态", "输出", "调用工具", "工具结果", "用量"],
  },
  { rk: "编排 · ORCHESTRATION", title: "BullMQ 串 HITL 流水线", body: "Worker + FlowProducer 串 7 阶段人机协同流水线，工具联网，全链路溯源 + 单写者锁挡并发写。" },
];

/* 跑马灯条目（demo strip）。 */
const MARQUEE = [
  "确定性初始化",
  "多角色 AI 编排",
  "真实联网检索带来源",
  "对抗验证三票裁决",
  "单写者锁",
  "全链路溯源",
];

export function LandingPage() {
  const nav = useNavigate();
  const api = useAuth((s) => s.api);
  const setSession = useAuth((s) => s.setSession);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 登录/注册：复用 Login 同款真实逻辑（打 /api/auth/*，成功跳 /projects，失败用 ErrorBanner）。
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = mode === "login" ? { email, password } : { email, password, name };
      const res = await api.json<{ userId: string; accessToken: string; refreshToken: string }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSession(res.userId, { accessToken: res.accessToken, refreshToken: res.refreshToken });
      nav("/projects");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    border: `2px solid ${LINE}`,
    background: "transparent",
    padding: "12px",
    fontFamily: BODY,
    fontSize: 15,
    borderRadius: 0,
    marginBottom: 16,
  };

  return (
    <div style={{ background: PAPER, color: INK, fontFamily: BODY, lineHeight: 1.5, minHeight: "100vh" }}>
      {/* 跑马灯动画 keyframes（组件内注入，保持横向滚动效果） */}
      <style>{`
        @keyframes boule-slide { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .boule-marquee { animation: boule-slide 26s linear infinite; }
        .boule-ph:hover { background: ${INK}; color: ${PAPER}; }
        .boule-ph:hover .boule-ph-no { color: ${BLUE}; }
        .boule-ph:hover .boule-ph-sub { color: #9a9a93; }
        .boule-ph:hover .boule-ph-note { color: #c9c9c2; }
        .boule-link:hover { opacity: 0.65; }
        ::selection { background: ${BLUE}; color: #fff; }
      `}</style>

      {/* ─── 导航 ─── */}
      <nav style={{ borderBottom: `2px solid ${LINE}`, position: "sticky", top: 0, background: PAPER, zIndex: 50 }}>
        <div
          style={{ maxWidth: 1320, margin: "0 auto", padding: "0 40px", height: 64 }}
          className="flex items-center justify-between"
        >
          <div className="flex items-baseline" style={{ gap: 12 }}>
            <div style={{ fontFamily: DISP, fontWeight: 800, fontSize: 22, letterSpacing: "-0.02em" }}>
              OpenConsult<span style={{ color: BLUE }}>///</span>
            </div>
            <span style={{ ...monoMeta, fontSize: 10, letterSpacing: "0.1em", color: MUT, border: `1.5px solid ${LINE}`, padding: "2px 7px" }}>
              代号 BOULE
            </span>
          </div>
          <div className="flex items-center" style={{ gap: 28 }}>
            <a href="#crew" className="boule-link" style={{ ...monoMeta, fontSize: 12, letterSpacing: "0.1em" }}>角色</a>
            <a href="#runtime" className="boule-link" style={{ ...monoMeta, fontSize: 12, letterSpacing: "0.1em" }}>运行环境</a>
            <a href="#method" className="boule-link" style={{ ...monoMeta, fontSize: 12, letterSpacing: "0.1em" }}>方法论</a>
            <a
              href={GITHUB}
              target="_blank"
              rel="noopener"
              className="boule-link"
              style={{ ...monoMeta, fontSize: 12, letterSpacing: "0.1em" }}
            >
              GitHub ↗
            </a>
            <a
              href="#login"
              style={{ ...monoMeta, fontSize: 12, letterSpacing: "0.1em", border: `2px solid ${LINE}`, padding: "8px 18px", background: INK, color: PAPER }}
            >
              登录
            </a>
          </div>
        </div>
      </nav>

      {/* ─── Hero + 登录 slab ─── */}
      <header style={{ borderBottom: `2px solid ${LINE}`, padding: "72px 0 56px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "0 40px" }}>
          <div className="flex items-center" style={{ ...monoMeta, fontSize: 12, letterSpacing: "0.18em", color: MUT, gap: 14, marginBottom: 28 }}>
            <span>EDITION 2026</span>—<b style={{ color: INK, fontWeight: 600 }}>OPENCONSULT · CLAUDE-ONLY AI CONSULTING WORKBENCH</b>—<span>开发代号 BOULE</span>
          </div>

          <h1 style={{ fontFamily: DISP, fontWeight: 800, fontSize: "clamp(54px,9vw,128px)", lineHeight: 0.92, letterSpacing: "-0.045em" }}>
            把咨询做成<br />一条
            <span style={{ background: BLUE, color: PAPER, padding: "0 0.12em", display: "inline-block", transform: "rotate(-1deg)" }}>
              流水线
            </span>
            。
          </h1>

          <div className="boule-hero-grid">
            <div>
              <p style={{ fontSize: 19, maxWidth: "46ch", color: "#1c1c1a" }}>
                9 个阶段，一支不睡觉的<b style={{ fontWeight: 600 }}>多角色创作团队</b>。Claude专用，不支持其它模型；需自带 Claude CLI 会话或 Anthropic Key。接案、调研、综合、三筛、交付——每一步都留下可追溯的来源与裁决记录。
              </p>
              <div className="flex flex-wrap" style={{ gap: 10, marginTop: 24 }}>
                <span
                  style={{
                    ...monoMeta,
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    border: `2px solid ${LINE}`,
                    padding: "6px 12px",
                    background: CLAUDE_ORANGE,
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    boxShadow: `4px 4px 0 ${LINE}`,
                  }}
                >
                  <ClaudeIcon size={15} /> Claude专用
                </span>
                <span style={{ ...monoMeta, fontSize: 11, letterSpacing: "0.06em", border: `2px solid ${LINE}`, padding: "6px 12px" }}>9 阶段流水线</span>
                <span style={{ ...monoMeta, fontSize: 11, letterSpacing: "0.06em", border: `2px solid ${LINE}`, padding: "6px 12px" }}>真联网调研</span>
                <span style={{ ...monoMeta, fontSize: 11, letterSpacing: "0.06em", border: `2px solid ${LINE}`, padding: "6px 12px" }}>对抗验证三票</span>
                <span style={{ ...monoMeta, fontSize: 11, letterSpacing: "0.06em", border: `2px solid ${LINE}`, padding: "6px 12px" }}>确定性脚手架</span>
              </div>
              <div className="flex items-center" style={{ gap: 14, marginTop: 34 }}>
                <a href="#login" style={{ fontFamily: DISP, fontWeight: 700, fontSize: 18, border: `2px solid ${LINE}`, padding: "14px 26px", background: BLUE, color: "#fff", display: "inline-flex", alignItems: "center", gap: 10 }}>
                  开始 <span style={{ fontFamily: BODY }}>▸</span>
                </a>
                <a href="#method" style={{ fontFamily: DISP, fontWeight: 700, fontSize: 18, border: `2px solid ${LINE}`, padding: "14px 26px", background: "transparent", color: INK, display: "inline-flex", alignItems: "center" }}>
                  看方法论
                </a>
              </div>
            </div>

            {/* 登录 slab（Nº 00）—— 真实登录逻辑 */}
            <div id="login" style={{ border: `2px solid ${LINE}`, background: PAPER, alignSelf: "start" }}>
              <div className="flex items-center justify-between" style={{ borderBottom: `2px solid ${LINE}`, padding: "14px 18px", background: INK, color: PAPER }}>
                <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em" }}>
                  Nº 00 — {mode === "login" ? "进入工作台" : "注册账号"}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em" }}>↵</span>
              </div>
              <div style={{ padding: "22px 18px" }}>
                {error && <div style={{ marginBottom: 14 }}><ErrorBanner severity="P0" message={error} /></div>}
                <form onSubmit={submit}>
                  {mode === "register" && (
                    <>
                      <label style={{ ...monoMeta, fontSize: 11, letterSpacing: "0.1em", color: MUT, display: "block", margin: "0 0 6px" }}>姓名</label>
                      <input style={inputStyle} id="boule-name" name="name" autoComplete="name" placeholder="你的名字" value={name} onChange={(e) => setName(e.target.value)} />
                    </>
                  )}
                  <label style={{ ...monoMeta, fontSize: 11, letterSpacing: "0.1em", color: MUT, display: "block", margin: "0 0 6px" }}>邮箱</label>
                  <input style={inputStyle} id="boule-email" name="email" autoComplete="email" type="email" placeholder="you@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <label style={{ ...monoMeta, fontSize: 11, letterSpacing: "0.1em", color: MUT, display: "block", margin: "0 0 6px" }}>密码</label>
                  <input style={inputStyle} id="boule-password" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button
                    type="submit"
                    disabled={busy}
                    style={{ width: "100%", border: `2px solid ${LINE}`, background: BLUE, color: "#fff", fontFamily: DISP, fontWeight: 700, fontSize: 16, padding: 13, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
                  >
                    {busy ? "处理中…" : mode === "login" ? "登录" : "注册"}
                  </button>
                </form>
                <div style={{ marginTop: 14, ...monoMeta, fontSize: 11, letterSpacing: "0.06em", color: MUT, textAlign: "center" }}>
                  {mode === "login" ? "没有账号? " : "已有账号? "}
                  <button
                    type="button"
                    onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
                    style={{ color: BLUE, borderBottom: `1px solid ${BLUE}`, background: "transparent", cursor: "pointer", ...monoMeta, fontSize: 11, letterSpacing: "0.06em" }}
                  >
                    {mode === "login" ? "注册 →" : "← 登录"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ─── 黑跑马灯 ─── */}
      <div style={{ borderBottom: `2px solid ${LINE}`, background: INK, color: PAPER, overflow: "hidden" }}>
        <div className="boule-marquee" style={{ display: "flex", gap: 48, whiteSpace: "nowrap", padding: "14px 0", fontFamily: DISP, fontWeight: 700, fontSize: 20, letterSpacing: "-0.01em" }}>
          {[0, 1].map((dup) => (
            <span key={dup} style={{ display: "flex", gap: 48 }} aria-hidden={dup === 1}>
              {MARQUEE.map((m, i) => (
                <span key={`${dup}-${i}`} style={{ display: "flex", gap: 48 }}>
                  <i style={{ color: BLUE, fontStyle: "normal" }}>///</i> {m}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* ─── Nº 01 能力 ─── */}
      <section id="caps" style={{ borderBottom: `2px solid ${LINE}` }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "0 40px" }}>
          <SecHead k="Nº 01 — CAPABILITIES" title="引擎做什么" />
          <div className="boule-caps" style={{ borderTop: `2px solid ${LINE}`, marginTop: 24 }}>
            {CAPABILITIES.map((c, i) => (
              <div key={c.no} style={{ padding: "28px 24px 34px", borderRight: i === CAPABILITIES.length - 1 ? "none" : `2px solid ${LINE}` }}>
                <div style={{ fontFamily: DISP, fontWeight: 800, fontSize: 42, color: BLUE, letterSpacing: "-0.04em", lineHeight: 1 }}>{c.no}</div>
                <h3 style={{ fontFamily: DISP, fontWeight: 700, fontSize: 21, margin: "16px 0 10px", letterSpacing: "-0.01em" }}>{c.title}</h3>
                <p style={{ fontSize: 14, color: "#33332e" }}>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Nº 02 角色编队 ─── */}
      <section id="crew" style={{ borderBottom: `2px solid ${LINE}` }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "0 40px" }}>
          <SecHead k="Nº 02 — CREW / SKILLS" title="7 个角色，各是一份能力包" />
          <div className="boule-crew" style={{ borderTop: `2px solid ${LINE}`, marginTop: 24 }}>
            {ROLES.map((r, i) => (
              <div
                key={r.rid}
                style={{
                  padding: "24px 22px 28px",
                  borderRight: (i + 1) % 4 === 0 ? "none" : `2px solid ${LINE}`,
                  borderBottom: `2px solid ${LINE}`,
                  background: r.dark ? INK : "transparent",
                  color: r.dark ? PAPER : "inherit",
                }}
              >
                <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.12em", color: BLUE }}>{r.rid}</div>
                <h3 style={{ fontFamily: DISP, fontWeight: 700, fontSize: 19, margin: "12px 0 4px", letterSpacing: "-0.01em", color: r.dark ? "#fff" : INK }}>{r.name}</h3>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: r.dark ? "#9a9a93" : MUT }}>{r.en}</div>
                <p style={{ fontSize: 13, color: r.dark ? "#c9c9c2" : "#33332e", marginTop: 10 }}>{r.body}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center" style={{ gap: 16, padding: "22px 0 32px" }}>
            <span style={{ ...monoMeta, fontSize: 11, letterSpacing: "0.1em", border: `2px solid ${LINE}`, background: INK, color: PAPER, padding: "7px 13px" }}>可扩展性</span>
            <p style={{ fontSize: 14, color: "#33332e", maxWidth: "62ch" }}>
              新增一个角色 = 一份 <code style={{ fontFamily: MONO, background: BLUE, color: "#fff", padding: "1px 6px", fontSize: 12 }}>roles/your-role.md</code> 提示词 + 一条调度映射(<code style={{ fontFamily: MONO, background: BLUE, color: "#fff", padding: "1px 6px", fontSize: 12 }}>mapRoleToFile</code>)。不改引擎核心，并发（多线并行）、串行质量校验、成本与事件流自动接上。
            </p>
          </div>
        </div>
      </section>

      {/* ─── Nº 03 运行时 ─── */}
      <section id="runtime" style={{ borderBottom: `2px solid ${LINE}` }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "0 40px" }}>
          <SecHead k="Nº 03 — RUNTIME" title="底层怎么跑 AI" />
          <div style={{ fontFamily: DISP, fontWeight: 800, fontSize: "clamp(22px,3vw,34px)", letterSpacing: "-0.02em", padding: "30px 0 0", lineHeight: 1.05 }}>
            每个角色 = 一次 <b style={{ background: BLUE, color: PAPER, padding: "0 0.1em" }}>Claude Agent SDK</b>{" "}
            <code style={{ fontFamily: MONO, fontSize: "0.7em" }}>query()</code> spawn。
          </div>
          <div className="flex flex-wrap items-center" style={{ gap: 14, marginTop: 14, fontFamily: MONO, fontSize: 13 }}>
            <span style={{ border: `2px solid ${LINE}`, padding: "8px 14px", fontWeight: 600 }}>Claude CLI 订阅会话</span>
            <span style={{ color: BLUE, fontWeight: 800 }}>⇄ apiKeySource 自动识别 ⇄</span>
            <span style={{ border: `2px solid ${LINE}`, padding: "8px 14px", fontWeight: 600 }}>ANTHROPIC_API_KEY</span>
          </div>
          <div className="boule-rt" style={{ borderTop: `2px solid ${LINE}`, marginTop: 24 }}>
            {RUNTIME.map((c, i) => (
              <div key={c.rk} style={{ padding: "26px 22px 30px", borderRight: i === RUNTIME.length - 1 ? "none" : `2px solid ${LINE}` }}>
                <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.12em", color: BLUE, textTransform: "uppercase" }}>{c.rk}</div>
                <h3 style={{ fontFamily: DISP, fontWeight: 700, fontSize: 20, margin: "12px 0 12px", letterSpacing: "-0.01em" }}>{c.title}</h3>
                <p style={{ fontSize: 14, color: "#33332e" }}>{c.body}</p>
                {c.events && (
                  <div className="flex flex-wrap" style={{ gap: 6, marginTop: 14 }}>
                    {c.events.map((ev) => (
                      <span key={ev} style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.05em", border: `1.5px solid ${LINE}`, padding: "4px 8px" }}>{ev}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Nº 04 方法论（PHASE_LABELS 真数据，7+2 阶段） ─── */}
      <section id="method" style={{ borderBottom: `2px solid ${LINE}`, paddingBottom: 8 }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "0 40px" }}>
          <SecHead k="Nº 04 — METHOD LOOP" title="从接案到交付的 7+2 阶段" />
          <div style={{ marginTop: 20 }}>
            {PHASE_LABELS.map((p, i) => (
              <div
                key={p.id}
                className="boule-ph boule-method-row"
                style={{ alignItems: "center", borderTop: i === 0 ? "none" : `2px solid ${LINE}`, padding: "18px 0", transition: "background .12s" }}
              >
                <div className="boule-ph-no" style={{ fontFamily: DISP, fontWeight: 800, fontSize: 34, letterSpacing: "-0.04em", color: INK }}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div style={{ fontFamily: DISP, fontWeight: 700, fontSize: 22, letterSpacing: "-0.01em" }}>
                  {p.label}
                  <small className="boule-ph-sub" style={{ fontFamily: MONO, fontWeight: 400, fontSize: 11, letterSpacing: "0.1em", color: MUT, display: "block", marginTop: 2, textTransform: "uppercase" }}>
                    {METHOD_KEY[p.id] ?? ""}
                  </small>
                </div>
                <div className="boule-ph-note" style={{ fontSize: 14, color: "#44443e" }}>{p.note}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 蓝色 GitHub strip ─── */}
      <div style={{ borderBottom: `2px solid ${LINE}`, background: BLUE, color: "#fff" }}>
        <div className="boule-gh-in flex flex-wrap items-center justify-between" style={{ maxWidth: 1320, margin: "0 auto", padding: "26px 40px", gap: 16 }}>
          <div style={{ fontFamily: DISP, fontWeight: 800, fontSize: "clamp(20px,2.6vw,30px)", letterSpacing: "-0.02em" }}>
            源码开放在 GitHub
            <small style={{ display: "block", fontFamily: MONO, fontWeight: 400, fontSize: 12, letterSpacing: "0.08em", opacity: 0.85, marginTop: 6 }}>
              github.com/ZCDeng/OpenBoule · 引擎 / 工作流 / 角色 prompt 全在仓库
            </small>
          </div>
          <a
            href={GITHUB}
            target="_blank"
            rel="noopener"
            style={{ border: "2px solid #fff", color: "#fff", background: "transparent", fontFamily: DISP, fontWeight: 700, fontSize: 16, padding: "12px 22px", display: "inline-flex", gap: 10 }}
          >
            Star on GitHub ↗
          </a>
        </div>
      </div>

      {/* ─── 巨号页脚 ─── */}
      <footer style={{ padding: "56px 0 40px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "0 40px" }}>
          <div style={{ fontFamily: DISP, fontWeight: 800, fontSize: "clamp(44px,9.5vw,128px)", letterSpacing: "-0.05em", lineHeight: 0.85 }}>
            OpenConsult<span style={{ color: BLUE }}>///</span>
          </div>
          <div className="flex flex-wrap items-end justify-between" style={{ marginTop: 30, gap: 20 }}>
            <div className="flex" style={{ gap: 22 }}>
              <a href="#crew" className="boule-link" style={{ ...monoMeta, fontSize: 12 }}>角色</a>
              <a href="#runtime" className="boule-link" style={{ ...monoMeta, fontSize: 12 }}>运行环境</a>
              <a href="#method" className="boule-link" style={{ ...monoMeta, fontSize: 12 }}>方法论</a>
              <a href={GITHUB} target="_blank" rel="noopener" className="boule-link" style={{ ...monoMeta, fontSize: 12 }}>GitHub ↗</a>
              <a href="#login" className="boule-link" style={{ ...monoMeta, fontSize: 12 }}>登录</a>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", color: MUT, textAlign: "right" }}>
EDITION 2026 · v1 · 开发代号 BOULE · 31.2306° N, 121.4737° E
            </div>
          </div>
        </div>
      </footer>

      {/* 响应式网格（brutalist 非对称网格，内联注入避免 Tailwind 任意值冗长） */}
      <style>{`
        .boule-hero-grid { display: grid; grid-template-columns: 1fr; gap: 48px; align-items: end; margin-top: 48px; }
        .boule-caps, .boule-crew, .boule-rt { display: grid; grid-template-columns: 1fr; }
        .boule-method-row { display: grid; grid-template-columns: 64px 1fr; gap: 16px; }
        @media (min-width: 720px) {
          .boule-caps { grid-template-columns: repeat(3, 1fr); }
          .boule-crew { grid-template-columns: repeat(2, 1fr); }
          .boule-rt { grid-template-columns: repeat(3, 1fr); }
          .boule-method-row { grid-template-columns: 96px 1fr 1.1fr; }
        }
        @media (min-width: 1024px) {
          .boule-hero-grid { grid-template-columns: 1.55fr 1fr; }
          .boule-caps { grid-template-columns: repeat(5, 1fr); }
          .boule-crew { grid-template-columns: repeat(4, 1fr); }
        }
      `}</style>
    </div>
  );
}

/* 方法论英文副标题（按 PHASE_LABELS 的 id 映射，demo 里 small 的那行）。 */
const METHOD_KEY: Record<string, string> = {
  phase0_init: "初始化",
  phase1_intake: "接案",
  phase1_5_axis: "维度",
  phase2_research: "调研",
  phase2_5_verify: "验证",
  phase3_synthesis: "综合",
  phase4_review: "审校",
  phase5_delivery: "交付",
  phase6_enrichment: "补强",
};


function ClaudeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ flex: "0 0 auto" }}>
      <path
        fill="currentColor"
        d="M12 1.8c.86 3.52 1.84 5.48 3.2 6.84s3.32 2.34 6.84 3.2c-3.52.86-5.48 1.84-6.84 3.2s-2.34 3.32-3.2 6.84c-.86-3.52-1.84-5.48-3.2-6.84s-3.32-2.34-6.84-3.2c3.52-.86 5.48-1.84 6.84-3.2s2.34-3.32 3.2-6.84Z"
      />
      <circle cx="12" cy="11.84" r="2.15" fill="#0B0B0B" opacity="0.18" />
    </svg>
  );
}

/* section 标题（Nº 编号 + 大标题）。 */
function SecHead({ k, title }: { k: string; title: string }) {
  return (
    <div className="flex flex-wrap items-baseline" style={{ gap: 18, padding: "34px 0 8px" }}>
      <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: BLUE }}>{k}</span>
      <h2 style={{ fontFamily: DISP, fontWeight: 800, fontSize: "clamp(28px,4vw,46px)", letterSpacing: "-0.03em", lineHeight: 1 }}>{title}</h2>
    </div>
  );
}
