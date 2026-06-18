/**
 * 进程内安全集 Redis 替身（macOS app / 本地零基础设施）。
 *
 * 只实现 Boule 安全集实际用到的命令子集，语义忠实于 ioredis：
 *   SSE ticket（set EX / getdel）、doc-lock（set NX EX / get / expire / ttl / eval 两段 Lua）、
 *   share 撤销集（sadd / sismember）、限流（incr / expire）、active-context（set EX / get）。
 *
 * 单进程：Map 存储 + 软过期（读时惰性清除）。eval 仅识别 doc-lock 的 RENEW/RELEASE 两段 compare-and-act 脚本。
 * 不追求 Redis 全兼容——仅供本地单用户运行，团队模式仍走真 Redis。
 */

interface Entry {
  value: string | Set<string>;
  expireAt: number | null; // ms epoch；null = 不过期
}

export class MemoryRedis {
  private readonly store = new Map<string, Entry>();

  private alive(key: string): Entry | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expireAt !== null && e.expireAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  /** SET key value [EX s | PX ms | KEEPTTL] [NX | XX] [GET]。返回 "OK" / null / 旧值（GET）。 */
  async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
    let ttlMs: number | null = null;
    let keepTtl = false;
    let nx = false;
    let xx = false;
    let getOld = false;
    for (let i = 0; i < args.length; i++) {
      const a = String(args[i]).toUpperCase();
      if (a === "EX") ttlMs = Number(args[++i]) * 1000;
      else if (a === "PX") ttlMs = Number(args[++i]);
      else if (a === "KEEPTTL") keepTtl = true;
      else if (a === "NX") nx = true;
      else if (a === "XX") xx = true;
      else if (a === "GET") getOld = true;
    }
    const existing = this.alive(key);
    const oldVal = existing && typeof existing.value === "string" ? existing.value : null;
    if (nx && existing) return getOld ? oldVal : null;
    if (xx && !existing) return getOld ? oldVal : null;
    const expireAt =
      ttlMs !== null ? Date.now() + ttlMs : keepTtl ? (existing?.expireAt ?? null) : null;
    this.store.set(key, { value, expireAt });
    return getOld ? oldVal : "OK";
  }

  async get(key: string): Promise<string | null> {
    const e = this.alive(key);
    return e && typeof e.value === "string" ? e.value : null;
  }

  /** GETDEL（原子取删，一次性 ticket 用）。 */
  async getdel(key: string): Promise<string | null> {
    const v = await this.get(key);
    this.store.delete(key);
    return v;
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const e = this.alive(key);
    if (!e) return 0;
    e.expireAt = Date.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const e = this.alive(key);
    if (!e) return -2; // 不存在
    if (e.expireAt === null) return -1; // 无过期
    return Math.max(0, Math.ceil((e.expireAt - Date.now()) / 1000));
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    let e = this.alive(key);
    if (!e || !(e.value instanceof Set)) {
      e = { value: new Set<string>(), expireAt: null };
      this.store.set(key, e);
    }
    const set = e.value as Set<string>;
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    return added;
  }

  async sismember(key: string, member: string): Promise<number> {
    const e = this.alive(key);
    return e && e.value instanceof Set && e.value.has(member) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const e = this.alive(key);
    const cur = e && typeof e.value === "string" ? parseInt(e.value, 10) || 0 : 0;
    const next = cur + 1;
    this.store.set(key, { value: String(next), expireAt: e?.expireAt ?? null });
    return next;
  }

  /**
   * EVAL：仅支持 doc-lock 的两段 compare-and-act 脚本：
   *   RENEW   = if GET(K)==ARGV1 then EXPIRE(K, ARGV2) else 0
   *   RELEASE = if GET(K)==ARGV1 then DEL(K) else 0
   * args = [key, expectedOwner, ttlSec?]。
   */
  async eval(script: string, _numKeys: number, ...args: unknown[]): Promise<number> {
    const key = String(args[0]);
    const expected = String(args[1]);
    const cur = await this.get(key);
    if (cur !== expected) return 0;
    if (script.includes("EXPIRE")) {
      await this.expire(key, Number(args[2]));
      return 1;
    }
    if (script.includes("DEL")) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }

  async exists(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.alive(k)) n++;
    return n;
  }

  async ping(): Promise<string> {
    return "PONG";
  }

  async quit(): Promise<"OK"> {
    this.store.clear();
    return "OK";
  }
}
