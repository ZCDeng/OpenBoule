/**
 * debounce 助手（U9）。autosave（2s 静默后保存）+ 锁心跳定时器。注入 scheduler 便于 node:test。
 */

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  flush(): void;
  cancel(): void;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
  scheduler: { set: (cb: () => void, ms: number) => number | NodeJS.Timeout; clear: (t: number | NodeJS.Timeout) => void } = {
    set: (cb, ms) => setTimeout(cb, ms),
    clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  },
): Debounced<A> {
  let timer: number | NodeJS.Timeout | null = null;
  let lastArgs: A | null = null;

  const debounced = ((...args: A) => {
    lastArgs = args;
    if (timer !== null) scheduler.clear(timer);
    timer = scheduler.set(() => {
      timer = null;
      if (lastArgs) fn(...lastArgs);
      lastArgs = null;
    }, waitMs);
  }) as Debounced<A>;

  debounced.flush = () => {
    if (timer !== null) {
      scheduler.clear(timer);
      timer = null;
    }
    if (lastArgs) {
      fn(...lastArgs);
      lastArgs = null;
    }
  };
  debounced.cancel = () => {
    if (timer !== null) {
      scheduler.clear(timer);
      timer = null;
    }
    lastArgs = null;
  };
  return debounced;
}
