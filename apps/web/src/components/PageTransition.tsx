import { useEffect, useRef, useState } from "react";
import type { Location } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { gsap, shouldAnimate } from "../lib/gsap.ts";
import { AppRoutes } from "../routes/index.tsx";

export function PageTransition() {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const contentRef = useRef<HTMLDivElement>(null);
  const transitionRef = useRef<gsap.core.Timeline | null>(null);
  const lastPathRef = useRef(pathKey(location));

  useEffect(() => {
    const nextKey = pathKey(location);
    if (nextKey === lastPathRef.current) return;
    lastPathRef.current = nextKey;

    transitionRef.current?.kill();
    const el = contentRef.current;
    if (!el || !shouldAnimate()) {
      setDisplayLocation(location);
      return;
    }

    transitionRef.current = gsap.timeline({ defaults: { overwrite: "auto" } })
      .to(el, { opacity: 0, duration: 0.16, ease: "power1.out" })
      .add(() => setDisplayLocation(location as Location))
      .fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.24, ease: "power2.out", clearProps: "opacity,transform" });

    return () => { transitionRef.current?.kill(); };
  }, [location]);

  return <div ref={contentRef}><AppRoutes location={displayLocation} /></div>;
}

function pathKey(location: Location) {
  return `${location.pathname}${location.search}${location.hash}`;
}
