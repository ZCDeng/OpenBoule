/**
 * Material3 Snackbar 容器（全局通知浮层）。读 notification store，底部居中堆叠。
 * 形态走 M3 token：inverse-surface 底 + on-inverse-surface 字 + elevation-3 + 小圆角；
 * kind 用左侧 4px 状态条标识（呼应工作台状态点色，不破 M3 中性底）。
 */

import { useNotifications, type ToastKind } from "../stores/notification.ts";

const RAIL: Record<ToastKind, string> = {
  info: "var(--status-running)",
  success: "var(--status-done)",
  warning: "var(--status-attention)",
  error: "var(--status-failed)",
};

export function SnackbarContainer() {
  const toasts = useNotifications((s) => s.toasts);
  const dismiss = useNotifications((s) => s.dismiss);
  if (toasts.length === 0) return null;

  return (
    <div className="boule-snackbar-wrap" role="region" aria-label="通知" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="boule-snackbar" style={{ borderInlineStartColor: RAIL[t.kind] }}>
          <div className="boule-snackbar__body">
            {t.title ? <div className="boule-snackbar__title">{t.title}</div> : null}
            <div className="boule-snackbar__msg">{t.message}</div>
          </div>
          {t.action ? (
            <button
              type="button"
              className="boule-snackbar__action"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button type="button" className="boule-snackbar__close" aria-label="关闭" onClick={() => dismiss(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
