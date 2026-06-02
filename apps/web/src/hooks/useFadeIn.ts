import type { RefObject } from "react";
import { gsap, shouldAnimate, useGSAP } from "../lib/gsap.ts";

interface FadeOptions { y?: number; duration?: number; delay?: number; dependencies?: unknown[]; }

export function useFadeIn(containerRef: RefObject<HTMLElement | null>, options: FadeOptions = {}) {
  useGSAP(
    () => {
      const el = containerRef.current;
      if (!el || !shouldAnimate()) return;
      gsap.from(el, {
        opacity: 0,
        y: options.y ?? 10,
        duration: options.duration ?? 0.3,
        delay: options.delay ?? 0,
        clearProps: "opacity,transform",
      });
    },
    { scope: containerRef, dependencies: options.dependencies ?? [] },
  );
}
