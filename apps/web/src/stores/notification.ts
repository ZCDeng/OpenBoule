/**
 * 通知 store（macOS app / 五类交互之「前后台状态和消息通知」）。
 *
 * 两层：
 *  - toasts：瞬时浮层（M3 Snackbar），自动消失。
 *  - messages：**持久化消息日志**（localStorage），把通知/工作流日志打印为可回看的消息（消息中心）。
 *
 * notify()  = 弹 toast + 落一条 message（默认）。
 * log()     = 只落 message（不弹 toast），供高频工作流事件「打印为消息保存」。
 * 窗口失焦 + Electron 外壳时，notify 额外经 window.boule.notify 弹 macOS 原生通知。
 */

import { create } from "zustand";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
  action?: { label: string; onClick: () => void };
}

/** 持久化消息（消息中心）。 */
export interface Message {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
  ts: number; // ms epoch
  read: boolean;
  source?: string; // 如 workflowId / 模块名
}

interface NotifyInput {
  kind?: ToastKind;
  title?: string;
  message: string;
  timeoutMs?: number;
  action?: { label: string; onClick: () => void };
  /** 默认 true：同时落一条持久消息。设 false 则只弹 toast 不入消息中心。 */
  persist?: boolean;
  source?: string;
}

interface LogInput {
  kind?: ToastKind;
  title?: string;
  message: string;
  source?: string;
}

interface NotificationState {
  toasts: Toast[];
  messages: Message[];
  notify: (input: NotifyInput) => number;
  /** 只落消息、不弹 toast（工作流日志用）。去重：相同 source+message 在 3s 内不重复落。 */
  log: (input: LogInput) => void;
  dismiss: (id: number) => void;
  clear: () => void;
  markAllRead: () => void;
  clearMessages: () => void;
  unreadCount: () => number;
}

const DEFAULT_TIMEOUT: Record<ToastKind, number> = { info: 5000, success: 5000, warning: 7000, error: 9000 };
const STORAGE_KEY = "boule.messages";
const MAX_MESSAGES = 300;

let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const recentLog = new Map<string, number>(); // dedup key → ts

interface BouleBridge { isDesktop?: boolean; notify?: (title: string, body: string) => Promise<boolean>; }
function bridge(): BouleBridge | undefined {
  return (globalThis as unknown as { boule?: BouleBridge }).boule;
}

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as Message[]) : [];
    // 恢复后 seq 续到最大 id 之后，避免新旧 id 撞。
    for (const m of arr) if (m.id > seq) seq = m.id;
    return arr;
  } catch {
    return [];
  }
}
function persistMessages(messages: Message[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    /* 配额/隐私模式失败：消息中心降级为内存态，无碍 */
  }
}

function kindLabel(kind: ToastKind): string {
  return kind === "error" ? "出错" : kind === "warning" ? "注意" : kind === "success" ? "完成" : "Boule";
}

export const useNotifications = create<NotificationState>((set, get) => ({
  toasts: [],
  messages: loadMessages(),

  notify: (input) => {
    const id = ++seq;
    const kind = input.kind ?? "info";
    set((st) => ({ toasts: [...st.toasts, { id, kind, title: input.title, message: input.message, action: input.action }] }));

    // 落持久消息（默认）。
    if (input.persist !== false) {
      const msg: Message = { id, kind, title: input.title, message: input.message, ts: Date.now(), read: false, source: input.source };
      set((st) => {
        const messages = [...st.messages, msg].slice(-MAX_MESSAGES);
        persistMessages(messages);
        return { messages };
      });
    }

    // 后台（失焦）+ 桌面外壳 → 原生通知。
    const b = bridge();
    if (b?.isDesktop && b.notify && typeof document !== "undefined" && document.hidden) {
      void b.notify(input.title ?? kindLabel(kind), input.message).catch(() => {});
    }

    const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT[kind];
    if (timeout > 0) timers.set(id, setTimeout(() => get().dismiss(id), timeout));
    return id;
  },

  log: (input) => {
    const kind = input.kind ?? "info";
    const dedupKey = `${input.source ?? ""}|${input.message}`;
    const now = Date.now();
    const last = recentLog.get(dedupKey);
    if (last && now - last < 3000) return; // 3s 内同源同文去重
    recentLog.set(dedupKey, now);

    const id = ++seq;
    const msg: Message = { id, kind, title: input.title, message: input.message, ts: now, read: false, source: input.source };
    set((st) => {
      const messages = [...st.messages, msg].slice(-MAX_MESSAGES);
      persistMessages(messages);
      return { messages };
    });
  },

  dismiss: (id) => {
    const t = timers.get(id);
    if (t) { clearTimeout(t); timers.delete(id); }
    set((st) => ({ toasts: st.toasts.filter((x) => x.id !== id) }));
  },
  clear: () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    set({ toasts: [] });
  },
  markAllRead: () => set((st) => {
    const messages = st.messages.map((m) => (m.read ? m : { ...m, read: true }));
    persistMessages(messages);
    return { messages };
  }),
  clearMessages: () => { persistMessages([]); set({ messages: [] }); },
  unreadCount: () => get().messages.reduce((n, m) => n + (m.read ? 0 : 1), 0),
}));

/** 命令式便捷入口。 */
export const toast = {
  info: (message: string, title?: string) => useNotifications.getState().notify({ kind: "info", message, title }),
  success: (message: string, title?: string) => useNotifications.getState().notify({ kind: "success", message, title }),
  warning: (message: string, title?: string) => useNotifications.getState().notify({ kind: "warning", message, title }),
  error: (message: string, title?: string) => useNotifications.getState().notify({ kind: "error", message, title }),
};

/** 工作流日志 → 落消息（不弹 toast）。 */
export const logMessage = (message: string, opts?: { kind?: ToastKind; title?: string; source?: string }) =>
  useNotifications.getState().log({ message, ...opts });
