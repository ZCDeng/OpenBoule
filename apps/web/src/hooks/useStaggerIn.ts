import type { RefObject } from "react";
import { gsap, shouldAnimate, useGSAP } from "../lib/gsap.ts";

interface StaggerOptions {
  y?: number;
  x?: number;
  duration?: number;
  stagger?: number;
  delay?: number;
  rotateX?: number;
  selector?: string;
  dependencies?: unknown[];
}

export function useStaggerIn(containerRef: RefObject<HTMLElement | null>, selector = ":scope > *", options: StaggerOptions = {}) {
  useGSAP(
    () => {
      const container = containerRef.current;
      if (!container || !shouldAnimate()) return;
      const targets = gsap.utils.toArray<HTMLElement>(options.selector ?? selector, container);
      if (targets.length === 0) return;
      gsap.from(targets, {
        opacity: 0,
        y: options.y ?? 14,
        x: options.x,
        rotateX: options.rotateX,
        transformOrigin: "50% 100%",
        duration: options.duration ?? 0.4,
        stagger: options.stagger ?? 0.06,
        delay: options.delay ?? 0,
        clearProps: "opacity,transform",
      });
    },
    { scope: containerRef, dependencies: options.dependencies ?? [] },
  );
}
