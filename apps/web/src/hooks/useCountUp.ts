import type { RefObject } from "react";
import { gsap, shouldAnimate, useGSAP } from "../lib/gsap.ts";

interface CountOptions { duration?: number; delay?: number; decimals?: number; prefix?: string; suffix?: string; formatter?: (value: number) => string; dependencies?: unknown[]; }

function defaultFormat(value: number, decimals = 0) {
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export function useCountUp(ref: RefObject<HTMLElement | null>, endValue: number, options: CountOptions = {}) {
  useGSAP(
    () => {
      const el = ref.current;
      if (!el || !Number.isFinite(endValue)) return;
      const format = options.formatter ?? ((value: number) => `${options.prefix ?? ""}${defaultFormat(value, options.decimals)}${options.suffix ?? ""}`);
      if (!shouldAnimate()) {
        el.textContent = format(endValue);
        return;
      }
      const proxy = { value: 0 };
      gsap.to(proxy, {
        value: endValue,
        duration: options.duration ?? 0.8,
        delay: options.delay ?? 0,
        ease: "power2.out",
        onUpdate: () => { el.textContent = format(proxy.value); },
        onComplete: () => { el.textContent = format(endValue); },
      });
    },
    { scope: ref, dependencies: [endValue, ...(options.dependencies ?? [])] },
  );
}
