import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin, useGSAP);
gsap.defaults({ duration: 0.5, ease: "power2.out" });

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function shouldAnimate() {
  return !prefersReducedMotion();
}

export { gsap, ScrollTrigger, SplitText, ScrambleTextPlugin, useGSAP };
