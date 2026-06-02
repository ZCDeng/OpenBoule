import { Component, type ReactNode } from "react";

/**
 * 应用级错误边界（放在 Layout 的 main 内，崩溃时保留顶部导航）。
 * - resetKey 变化（如路由切换）时自动复位，避免「崩一次白到底、只能硬刷新」。
 * - 提供「重试」按钮手动复位（同一路由内的崩溃，如 tab 切换）。
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl px-6 py-16">
          <div className="border-2 border-black bg-[var(--boule-paper)] p-6 shadow-[4px_4px_0_#0B0B0B]">
            <p className="font-[var(--boule-mono)] text-xs uppercase tracking-[0.12em] text-[var(--boule-red)]">
              RENDER ERROR
            </p>
            <h2 className="mt-2 font-[var(--boule-disp)] text-3xl font-black tracking-[-0.03em]">
              此区块加载失败
            </h2>
            <p className="mt-2 text-sm text-[var(--boule-muted)]">
              页面其它部分仍可用，可切换导航或重试。
            </p>
            <pre className="mt-4 max-h-40 overflow-auto border-2 border-current bg-transparent p-3 font-[var(--boule-mono)] text-xs">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="mt-4 border-2 border-black bg-[var(--boule-blue)] px-4 py-2 font-[var(--boule-disp)] font-black text-white shadow-[3px_3px_0_#0B0B0B]"
            >
              重试 →
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
