/**
 * ⌘K 命令栏 UI（U5）。cmdk 提供 combobox/listbox + 键盘导航 + aria-activedescendant +
 * scrollIntoView（KTD-3）；列表与分组完全由 lib/command-registry 的 buildResults 驱动
 * （shouldFilter=false，充分用上 U4 已测逻辑）。react-hotkeys-hook 注册全局 ⌘K。
 *
 * 取舍（编码纪律 7）：KTD-2 提到 react-hotkeys-hook 默认不在表单/contentEditable 触发以避
 * 冲突；但 ⌘K 作为全局命令入口需处处可唤起（含 tiptap，见 U5 测试场景），故对该组合显式
 * 开 enableOnFormTags/ContentEditable + preventDefault，拦浏览器/编辑器默认。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useHotkeys } from "react-hotkeys-hook";
import { Command } from "cmdk";
import { buildResults, readRecent, recordRecent, type Command as Cmd } from "../lib/command-registry.ts";

interface ProjectsCache {
  projects: { id: string; name: string }[];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const triggerRef = useRef<HTMLElement | null>(null);

  useHotkeys(
    "mod+k",
    (e) => {
      e.preventDefault();
      setOpen((o) => !o);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // 开/关：存触发元素、清查询；关闭时把焦点归还触发元素（KTD-3）。
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      setQuery("");
    } else if (triggerRef.current) {
      triggerRef.current.focus?.();
      triggerRef.current = null;
    }
  }, [open]);

  // 项目源走 ["projects"] query 缓存（不触发请求；未访问过 Projects 则为空）。
  const projects = qc.getQueryData<ProjectsCache>(["projects"])?.projects ?? [];
  const recentIds = open ? readRecent(localStorage) : [];
  const results = buildResults({ query, projects, recentIds });
  const total = results.recent.length + results.commands.length + results.projects.length;

  const run = useCallback(
    (cmd: Cmd) => {
      recordRecent(localStorage, cmd.id);
      setOpen(false);
      navigate(cmd.path);
    },
    [navigate],
  );

  if (!open) return null;

  const renderGroup = (heading: string, items: Cmd[]) =>
    items.length > 0 ? (
      <Command.Group heading={heading} className="boule-cmdk-group">
        {items.map((c) => (
          <Command.Item key={c.id} value={c.id} onSelect={() => run(c)} className="boule-cmdk-item">
            <span className="boule-cmdk-item__lbl">{c.label}</span>
            <span className="boule-cmdk-item__hint">{c.group === "PROJECTS" ? "PROJECT" : "NAV"}</span>
          </Command.Item>
        ))}
      </Command.Group>
    ) : null;

  return (
    <div className="boule-cmdk-overlay" onMouseDown={() => setOpen(false)}>
      <div className="boule-cmdk-palette" onMouseDown={(e) => e.stopPropagation()}>
        <Command
          shouldFilter={false}
          loop
          label="命令面板"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
        >
          <div className="boule-cmdk-bar">
            <span className="boule-cmdk-led" />
            COMMAND
            <span style={{ flex: 1 }} />
            ⌘K
          </div>
          <div className="boule-cmdk-input-wrap">
            <span className="boule-cmdk-prompt">&gt;</span>
            <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="搜索命令、项目…" className="boule-cmdk-input" />
          </div>
          <Command.List className="boule-cmdk-list">
            <Command.Empty className="boule-cmdk-empty">无匹配</Command.Empty>
            {renderGroup("RECENT", results.recent)}
            {renderGroup("COMMANDS", results.commands)}
            {renderGroup("PROJECTS", results.projects)}
          </Command.List>
          <div className="boule-cmdk-foot">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> SELECT
            </span>
            <span>
              <kbd>↵</kbd> GO
            </span>
            <span>
              <kbd>esc</kbd> CLOSE
            </span>
          </div>
        </Command>
        <span aria-live="polite" className="sr-only">
          {total} 个结果
        </span>
      </div>
    </div>
  );
}
