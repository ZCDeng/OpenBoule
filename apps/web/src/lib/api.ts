/**
 * API 客户端（U7）。401 时自动用 refresh token 换新 access 并重试一次；刷新失败 → onAuthLost。
 *
 * 依赖注入（fetch / token 存取 / onAuthLost），便于 node:test 不起浏览器测刷新逻辑。
 */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface ApiClientDeps {
  fetchImpl?: typeof fetch;
  getTokens: () => Tokens | null;
  setTokens: (t: Tokens | null) => void;
  onAuthLost?: () => void;
  baseUrl?: string;
}

export class ApiError extends Error {
  // Node strip-only 不支持参数属性，显式声明 + 赋值。
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly deps: ApiClientDeps;
  private readonly baseUrl: string;
  private refreshing: Promise<boolean> | null = null;

  constructor(deps: ApiClientDeps) {
    this.deps = deps;
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = deps.baseUrl ?? "";
  }

  private authHeader(): Record<string, string> {
    const t = this.deps.getTokens();
    return t ? { authorization: `Bearer ${t.accessToken}` } : {};
  }

  /** 单飞刷新：并发 401 只触发一次 refresh。返回是否刷新成功。 */
  private async refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const t = this.deps.getTokens();
      if (!t) return false;
      const res = await this.fetchImpl(`${this.baseUrl}/api/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: t.refreshToken }),
      });
      if (!res.ok) {
        this.deps.setTokens(null);
        this.deps.onAuthLost?.();
        return false;
      }
      const body = (await res.json()) as Tokens;
      this.deps.setTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken });
      return true;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** 发请求；401 且非刷新端点 → 刷新一次后重试；仍 401 → onAuthLost + 抛。 */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = { ...(init.headers as Record<string, string>), ...this.authHeader() };
    let res = await this.fetchImpl(url, { ...init, headers });
    if (res.status === 401 && !path.includes("/auth/")) {
      const ok = await this.refresh();
      if (!ok) throw new ApiError(401, "AUTH_LOST", "会话失效，请重新登录");
      res = await this.fetchImpl(url, { ...init, headers: { ...headers, ...this.authHeader() } });
      if (res.status === 401) {
        this.deps.setTokens(null);
        this.deps.onAuthLost?.();
        throw new ApiError(401, "AUTH_LOST", "会话失效，请重新登录");
      }
    }
    return res;
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    // 仅在有 body 时声明 JSON content-type：空 body 的 POST（如 /api/sse/ticket）
    // 若带 content-type:application/json，Fastify 会以 FST_ERR_CTP_EMPTY_JSON_BODY 拒绝（400）。
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (init.body != null && headers["content-type"] === undefined && !(init.body instanceof FormData)) {
      headers["content-type"] = "application/json";
    }
    const res = await this.request(path, { ...init, headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new ApiError(res.status, body.error ?? "ERROR", body.message);
    }
    return (await res.json()) as T;
  }
}
