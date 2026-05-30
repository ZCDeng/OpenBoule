/**
 * 认证 store（U7）。Zustand 持有 tokens（持久化 localStorage）+ 派生 ApiClient。
 * token 过期由 ApiClient 自动刷新；刷新失败 onAuthLost → 清状态（路由层跳登录）。
 */

import { create } from "zustand";
import { ApiClient, type Tokens } from "../lib/api.ts";

const STORAGE_KEY = "boule.tokens";

function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

interface AuthState {
  tokens: Tokens | null;
  userId: string | null;
  api: ApiClient;
  isAuthed: () => boolean;
  setSession: (userId: string, tokens: Tokens) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>((set, get) => {
  const persist = (t: Tokens | null) => {
    if (t) localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    else localStorage.removeItem(STORAGE_KEY);
  };

  const api = new ApiClient({
    getTokens: () => get().tokens,
    setTokens: (t) => {
      persist(t);
      set({ tokens: t });
    },
    onAuthLost: () => {
      persist(null);
      set({ tokens: null, userId: null });
    },
  });

  return {
    tokens: loadTokens(),
    userId: null,
    api,
    isAuthed: () => get().tokens !== null,
    setSession: (userId, tokens) => {
      persist(tokens);
      set({ userId, tokens });
    },
    logout: () => {
      void api.request("/api/auth/logout", { method: "POST" }).catch(() => {});
      persist(null);
      set({ tokens: null, userId: null });
    },
  };
});
