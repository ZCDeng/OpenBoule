/**
 * 主题 store。三态 preference：system（跟随系统）/ light / dark，持久化 localStorage。
 * 真正写入 <html data-theme> 的是「解析后的」light/dark；system 态下监听 prefers-color-scheme 变化。
 * 防闪烁：首帧前由 index.html 内联脚本先写好 data-theme，本 store 启动时校准一致。
 */

import { create } from "zustand";

export type ThemePref = "system" | "light" | "dark";
const STORAGE_KEY = "boule.theme";
const ORDER: ThemePref[] = ["system", "light", "dark"];

function loadPref(): ThemePref {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* localStorage 不可用时退回 system */
  }
  return "system";
}

function systemDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref === "system") return systemDark() ? "dark" : "light";
  return pref;
}

/** 把解析后的主题写到 <html data-theme>；light 态移除 attribute（默认即亮色）。 */
function apply(pref: ThemePref): "light" | "dark" {
  const resolved = resolve(pref);
  const el = document.documentElement;
  if (resolved === "dark") el.setAttribute("data-theme", "dark");
  else el.removeAttribute("data-theme");
  return resolved;
}

interface ThemeState {
  pref: ThemePref;
  resolved: "light" | "dark";
  setPref: (pref: ThemePref) => void;
  cycle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const initial = loadPref();

  // system 态：监听系统切换，实时重算（手动 light/dark 时忽略）。
  if (typeof matchMedia === "function") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (get().pref === "system") set({ resolved: apply("system") });
    });
  }

  return {
    pref: initial,
    resolved: resolve(initial),
    setPref: (pref) => {
      try {
        localStorage.setItem(STORAGE_KEY, pref);
      } catch {
        /* 忽略持久化失败 */
      }
      set({ pref, resolved: apply(pref) });
    },
    cycle: () => {
      const next = ORDER[(ORDER.indexOf(get().pref) + 1) % ORDER.length] ?? "system";
      get().setPref(next);
    },
  };
});
