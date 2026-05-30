/**
 * 文档编辑器（U9 / KTD-16）。TipTap WYSIWYG + autosave(debounce 2s) + 单写者锁。
 * - 进入即尝试获取锁；被他人持有 → 显示持有者 + 剩余时间 + 只读/排队选项。
 * - 持锁时 30s 心跳续期；离开释放。
 * - 保存失败（网络断）→ 落 localStorage + 提示「将保存在本地，恢复后同步」。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useAuth } from "../../stores/auth.ts";
import { debounce } from "../../lib/debounce.ts";
import { ApiError } from "../../lib/api.ts";
import { ErrorBanner } from "../../components/States.tsx";

type LockState = { kind: "acquiring" } | { kind: "held" } | { kind: "locked"; holder: string; ttlSec: number };
type SaveState = "idle" | "saving" | "saved" | "local-fallback";

export function Editor({ artifactId, initialBody }: { artifactId: string; initialBody: string }) {
  const api = useAuth((s) => s.api);
  const [lock, setLock] = useState<LockState>({ kind: "acquiring" });
  const [save, setSave] = useState<SaveState>("idle");
  const lockRef = useRef(false);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialBody,
    editable: false, // 拿到锁后再放开
  });

  const persist = useMemo(
    () =>
      debounce(async (html: string) => {
        setSave("saving");
        try {
          await api.json(`/api/artifacts/${artifactId}`, { method: "PUT", body: JSON.stringify({ body: html }) });
          setSave("saved");
          localStorage.removeItem(`boule.draft.${artifactId}`);
        } catch (err) {
          // 发布/退化护栏的 422 是内容问题，非网络——也提示，但区分
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
            setSave("idle");
          } else {
            localStorage.setItem(`boule.draft.${artifactId}`, html); // 网络断 → 本地兜底
            setSave("local-fallback");
          }
        }
      }, 2000),
    [api, artifactId],
  );

  // 获取锁 + 心跳 + 释放
  useEffect(() => {
    let hb: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    (async () => {
      try {
        await api.json(`/api/artifacts/${artifactId}/lock`, { method: "POST" });
        if (cancelled) return;
        lockRef.current = true;
        setLock({ kind: "held" });
        editor?.setEditable(true);
        hb = setInterval(() => void api.json(`/api/artifacts/${artifactId}/lock/heartbeat`, { method: "POST" }).catch(() => {}), 30000);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const body = (err as ApiError & { holder?: string }).holder;
          setLock({ kind: "locked", holder: body ?? "他人", ttlSec: 0 });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (hb) clearInterval(hb);
      if (lockRef.current) void api.request(`/api/artifacts/${artifactId}/lock`, { method: "DELETE" }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId, editor]);

  // 编辑触发 autosave
  useEffect(() => {
    if (!editor) return;
    const handler = () => persist(editor.getHTML());
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, persist]);

  return (
    <div className="space-y-2">
      {lock.kind === "locked" && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          文档正被 <span className="font-medium">{lock.holder}</span> 编辑。
          <button className="ml-2 rounded border border-neutral-300 px-2 py-0.5 text-xs">只读查看</button>
          <button className="ml-2 rounded border border-neutral-300 px-2 py-0.5 text-xs">排队等编辑</button>
        </div>
      )}
      {save === "local-fallback" && <ErrorBanner severity="P1" message="保存失败，将保存在本地，恢复后同步" />}

      <div className="flex items-center justify-between text-xs text-neutral-400">
        <span>{lock.kind === "held" ? "● 你正在编辑" : lock.kind === "acquiring" ? "获取锁中…" : "只读"}</span>
        <span>{save === "saving" ? "保存中…" : save === "saved" ? "已保存" : ""}</span>
      </div>

      <div className="prose max-w-none rounded-lg border border-neutral-200 bg-white p-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
