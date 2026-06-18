/**
 * 消息中心（M3 抽屉）。把持久化的通知/工作流日志按时间倒序列出，支持全部已读 / 清空。
 * 由顶栏铃铛唤起，铃铛带未读角标。
 */
import { useState } from "react";
import { useNotifications, type ToastKind } from "../stores/notification.ts";
import { relativeTime } from "../lib/time.ts";
import { Icon } from "./Icon.tsx";

const DOT: Record<ToastKind, string> = {
  info: "var(--status-running)",
  success: "var(--status-done)",
  warning: "var(--status-attention)",
  error: "var(--status-failed)",
};

export function MessageCenterButton() {
  const [open, setOpen] = useState(false);
  const messages = useNotifications((s) => s.messages);
  const unread = useNotifications((s) => s.unreadCount());
  const markAllRead = useNotifications((s) => s.markAllRead);
  const clearMessages = useNotifications((s) => s.clearMessages);

  const ordered = [...messages].reverse();

  return (
    <>
      <button
        type="button"
        aria-label={`消息中心${unread > 0 ? `（${unread} 条未读）` : ""}`}
        onClick={() => { setOpen(true); }}
        className="relative flex items-center rounded-full px-3 py-2 text-[var(--md-on-surface-variant)] transition-colors hover:bg-[var(--row-hover-bg)]"
      >
        <Icon name="notifications" size={20} />
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-semibold"
            style={{ background: "var(--md-error)", color: "#fff" }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="boule-scrim" style={{ justifyContent: "flex-end", alignItems: "stretch", padding: 0 }} onClick={() => setOpen(false)} role="presentation">
          <aside
            className="boule-msg-drawer"
            role="dialog"
            aria-label="消息中心"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--md-outline-variant)" }}>
              <div className="font-[var(--boule-disp)] text-[18px] font-semibold">消息中心</div>
              <div className="flex items-center gap-2">
                <button type="button" className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[var(--md-on-surface-variant)] hover:bg-[var(--row-hover-bg)]" onClick={() => markAllRead()}>全部已读</button>
                <button type="button" className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[var(--md-on-surface-variant)] hover:bg-[var(--row-hover-bg)]" onClick={() => clearMessages()}>清空</button>
                <button type="button" aria-label="关闭" className="flex items-center rounded-full p-2 text-[var(--md-on-surface-variant)] hover:bg-[var(--row-hover-bg)]" onClick={() => setOpen(false)}><Icon name="close" size={18} /></button>
              </div>
            </header>
            <div className="flex-1 overflow-auto px-3 py-3">
              {ordered.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[var(--md-on-surface-variant)]">还没有消息。通知与工作流日志会保存在这里。</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {ordered.map((m) => (
                    <li key={m.id} className="rounded-[var(--md-shape-sm)] px-3 py-2.5" style={{ background: m.read ? "transparent" : "var(--row-hover-bg)" }}>
                      <div className="flex items-start gap-2.5">
                        <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[m.kind] }} />
                        <div className="min-w-0 flex-1">
                          {m.title && <div className="text-[13px] font-semibold text-[var(--md-on-surface)]">{m.title}</div>}
                          <div className="text-[13px] text-[var(--md-on-surface-variant)]" style={{ overflowWrap: "anywhere" }}>{m.message}</div>
                          <div className="mt-1 text-[11px] text-[var(--md-on-surface-variant)] opacity-70">{relativeTime(new Date(m.ts).toISOString())}</div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
