/**
 * 通知 store（macOS app / 五类交互之「前后台状态和消息通知」）。
 *
 * 全局 Snackbar 队列：前台时 Material3 Snackbar 浮层提示；窗口失焦（document.hidden）且运行在 Electron
 * 外壳里时，额外经 window.boule.notify 弹 macOS 原生通知（前后台分流）。统一入口替散落的 ErrorBanner。
 */

import { create } from "zustand";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
  /** 可选操作（如「查看」），点击后自动 dismiss。 */
  action?: { label: string; onClick: () => void };
}

interface NotifyInput {
  kind?: ToastKind;
  title?: string;
  message: string;
  /** 毫秒；0 = 不自动消失（需手动/操作关闭）。默认 info/success 5s、warning 7s、error 9s。 */
  timeoutMs?: number;
  action?: { label: string; onClick: () => void };
}

interface NotificationState {
  toasts: Toast[];
  notify: (input: NotifyInput) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

const DEFAULT_TIMEOUT: Record<ToastKind, number> = {
  info: 5000,
  success: 5000,
  warning: 7000,
  error: 9000,
};

let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Electron 外壳暴露的极小原生桥（见 apps/desktop/preload.js）。非桌面时 undefined。 */
interface BouleBridge {
  isDesktop?: boolean;
  notify?: (title: string, body: string) => Promise<boolean>;
}
function bridge(): BouleBridge | undefined {
  return (globalThis as unknown as { boule?: BouleBridge }).boule;
}

export const useNotifications = create<NotificationState>((set, get) => ({
  toasts: [],
  notify: (input) => {
    const id = ++seq;
    const kind = input.kind ?? "info";
    const toast: Toast = { id, kind, title: input.title, message: input.message, action: input.action };
    set((st) => ({ toasts: [...st.toasts, toast] }));

    // 后台（窗口失焦）+ 桌面外壳 → 原生通知（best-effort，失败静默）。
    const b = bridge();
    if (b?.isDesktop && b.notify && typeof document !== "undefined" && document.hidden) {
      void b.notify(input.title ?? kindLabel(kind), input.message).catch(() => {});
    }

    const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT[kind];
    if (timeout > 0) {
      timers.set(
        id,
        setTimeout(() => get().dismiss(id), timeout),
      );
    }
    return id;
  },
  dismiss: (id) => {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
    set((st) => ({ toasts: st.toasts.filter((x) => x.id !== id) }));
  },
  clear: () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    set({ toasts: [] });
  },
}));

function kindLabel(kind: ToastKind): string {
  return kind === "error" ? "出错" : kind === "warning" ? "注意" : kind === "success" ? "完成" : "Boule";
}

/** 命令式便捷入口（非组件里也能调）。 */
export const toast = {
  info: (message: string, title?: string) => useNotifications.getState().notify({ kind: "info", message, title }),
  success: (message: string, title?: string) => useNotifications.getState().notify({ kind: "success", message, title }),
  warning: (message: string, title?: string) => useNotifications.getState().notify({ kind: "warning", message, title }),
  error: (message: string, title?: string) => useNotifications.getState().notify({ kind: "error", message, title }),
};
