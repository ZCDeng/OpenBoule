import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth.ts";
import { ApiError } from "../lib/api.ts";
import { ErrorBanner } from "../components/States.tsx";
import { Badge, Button, PageShell, Panel, TextInput } from "../components/Brutalist.tsx";

export function LoginPage() {
  const nav = useNavigate();
  const api = useAuth((s) => s.api);
  const setSession = useAuth((s) => s.setSession);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <PageShell>
      <div className="grid gap-8 lg:grid-cols-[1.15fr_.85fr] lg:items-end">
        <header className="border-b-2 border-black pb-8">
          <div className="boule-eyebrow">Nº 00 — AUTH GATE</div>
          <h1 className="boule-title">进入<br />咨询流水线。</h1>
          <p className="boule-lede">Claude-only 工作台。注册后即可创建项目、上传 reference、启动 7+2 阶段咨询工作流。</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Badge tone="orange">Claude专用</Badge>
            <Badge>JWT Session</Badge>
            <Badge>Owner Workspace</Badge>
          </div>
        </header>

        <Panel>
          <div className="flex items-center justify-between border-b-2 border-black bg-black px-5 py-4 text-white">
            <span className="font-[var(--boule-mono)] text-xs uppercase tracking-[0.16em]">{mode === "login" ? "登录" : "注册"}</span>
            <span className="font-[var(--boule-mono)] text-xs">↵</span>
          </div>
          <div className="boule-panel-body">
            {error && <div className="mb-4"><ErrorBanner severity="P0" message={error} /></div>}
            <form onSubmit={submit} className="space-y-4">
              {mode === "register" && <TextInput placeholder="姓名" value={name} onChange={(e) => setName(e.target.value)} />}
              <TextInput placeholder="邮箱" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <TextInput placeholder="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button disabled={busy} className="w-full">{busy ? "处理中…" : mode === "login" ? "登录" : "注册"}</Button>
            </form>
            <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }} className="mt-5 w-full border-b-2 border-black pb-1 text-center font-[var(--boule-mono)] text-xs uppercase tracking-[0.1em] text-[var(--boule-muted)] hover:text-black">
              {mode === "login" ? "没有账号？注册 →" : "已有账号？← 登录"}
            </button>
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
