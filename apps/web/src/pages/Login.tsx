import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth.ts";
import { ApiError } from "../lib/api.ts";
import { ErrorBanner } from "../components/States.tsx";

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
    <div className="mx-auto mt-24 max-w-sm px-6">
      <h1 className="mb-6 text-center text-2xl">OpenConsult · 咨询工作台</h1>
      {error && <div className="mb-4"><ErrorBanner severity="P0" message={error} /></div>}
      <form onSubmit={submit} className="space-y-3">
        {mode === "register" && (
          <input className="w-full rounded border border-neutral-300 px-3 py-2" placeholder="姓名" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <input className="w-full rounded border border-neutral-300 px-3 py-2" placeholder="邮箱" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded border border-neutral-300 px-3 py-2" placeholder="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} className="w-full rounded bg-neutral-900 py-2 text-white disabled:opacity-50">
          {busy ? "处理中…" : mode === "login" ? "登录" : "注册"}
        </button>
      </form>
      <button onClick={() => setMode(mode === "login" ? "register" : "login")} className="mt-4 w-full text-center text-sm text-neutral-500">
        {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
      </button>
    </div>
  );
}
