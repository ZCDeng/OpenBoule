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
import { ApiClient, ApiError } from "../../lib/api.ts";
import { ErrorBanner } from "../../components/States.tsx";
import { statusLabel } from "../../lib/labels.ts";
import { Badge, Button } from "../../components/Brutalist.tsx";

type LockState = { kind: "acquiring" } | { kind: "held" } | { kind: "locked"; holder: string; ttlSec: number };
type SaveState = "idle" | "saving" | "saved" | "local-fallback";

export interface EditorArtifactMeta {
  phase: string;
  phaseLabel: string;
  type: string;
  version: number;
  status: string;
  stale?: boolean;
}

async function acquireEditorLock(api: ApiClient, artifactId: string): Promise<{ holder: string; ttlSec: number }> {
  const res = await api.request(`/api/artifacts/${artifactId}/lock`, { method: "POST" });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { holder?: string; ttlSec?: number };
    throw new ApiError(409, "LOCKED", JSON.stringify({ holder: body.holder ?? "他人", ttlSec: body.ttlSec ?? 0 }));
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, body.error ?? "ERROR", body.message);
  }
  return { holder: "self", ttlSec: 0 };
}

export function Editor({
  artifactId,
  initialBody,
  meta,
  readOnly = false,
  onSaved,
}: {
  artifactId: string;
  initialBody: string;
  meta: EditorArtifactMeta;
  readOnly?: boolean;
  onSaved?: (nextId: string) => void;
}) {
  const api = useAuth((s) => s.api);
  const [lock, setLock] = useState<LockState>(readOnly ? { kind: "locked", holder: "只读模式", ttlSec: 0 } : { kind: "acquiring" });
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
          const saved = await api.json<{ id: string; version: number }>(`/api/artifacts/${artifactId}`, { method: "PUT", body: JSON.stringify({ body: html }) });
          setSave("saved");
          localStorage.removeItem(`boule.draft.${artifactId}`);
          onSaved?.(saved.id);
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
    [api, artifactId, onSaved],
  );

  // 获取锁 + 心跳 + 释放
  useEffect(() => {
    if (readOnly) {
      editor?.setEditable(false);
      setLock({ kind: "locked", holder: "只读模式", ttlSec: 0 });
      return;
    }
    let hb: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    (async () => {
      try {
        await acquireEditorLock(api, artifactId);
        if (cancelled) return;
        lockRef.current = true;
        setLock({ kind: "held" });
        editor?.setEditable(true);
        hb = setInterval(() => void api.json(`/api/artifacts/${artifactId}/lock/heartbeat`, { method: "POST" }).catch(() => {}), 30000);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const body = JSON.parse(err.message || "{}") as { holder?: string; ttlSec?: number };
          setLock({ kind: "locked", holder: body.holder ?? "他人", ttlSec: body.ttlSec ?? 0 });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (hb) clearInterval(hb);
      if (lockRef.current) void api.request(`/api/artifacts/${artifactId}/lock`, { method: "DELETE" }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, artifactId, editor, readOnly]);

  // 编辑触发 autosave
  useEffect(() => {
    if (!editor || readOnly) return;
    const handler = () => persist(editor.getHTML());
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, persist, readOnly]);

  return (
    <div className="space-y-2">
      {lock.kind === "locked" && (
        <div className="border-2 border-black bg-[var(--boule-orange)] p-3 text-sm text-white shadow-[4px_4px_0_#0B0B0B]">
          {readOnly ? (
            <span>正在只读查看历史版本或锁定文档。</span>
          ) : (
            <>
              文档正被 <span className="font-bold">{lock.holder}</span> 编辑
              {lock.ttlSec > 0 ? `，预计 ${lock.ttlSec}s 后过期` : ""}。
              <Button type="button" variant="secondary" className="ml-2" onClick={() => editor?.setEditable(false)}>
                只读查看
              </Button>
              <Button type="button" variant="secondary" disabled className="ml-2" title="当前未实现后端排队">
                排队等编辑
              </Button>
            </>
          )}
        </div>
      )}
      {save === "local-fallback" && <ErrorBanner severity="P1" message="保存失败，将保存在本地，恢复后同步" />}

      <div className="border-2 border-black px-3 py-2 shadow-[3px_3px_0_#0B0B0B]">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-[var(--boule-disp)] font-black tracking-[-0.02em]">{meta.phaseLabel}</span>
          <span>{meta.type}</span>
          <Badge>v{meta.version}</Badge>
          <Badge>{statusLabel(meta.status)}</Badge>
          {meta.stale && <Badge tone="orange">{statusLabel("stale")}</Badge>}
        </div>
      </div>

      <div className="flex items-center justify-between font-[var(--boule-mono)] text-xs uppercase tracking-[0.08em] text-[var(--boule-muted)]">
        <span>{readOnly ? "只读历史版本" : lock.kind === "held" ? "● 你正在编辑" : lock.kind === "acquiring" ? "获取锁中…" : "只读"}</span>
        <span>{save === "saving" ? "保存中…" : save === "saved" ? "已保存" : ""}</span>
      </div>

      <div className="prose max-w-none border-2 border-black bg-[var(--boule-paper)] p-4 shadow-[5px_5px_0_#0B0B0B]">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
