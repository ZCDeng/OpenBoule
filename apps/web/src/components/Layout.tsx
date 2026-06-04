import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Navigation } from "./Navigation.tsx";
import { OfflineBanner } from "./States.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { useWorkflow } from "../stores/workflow.ts";

export function Layout({ children }: { children: ReactNode }) {
  const connection = useWorkflow((s) => s.connection);
  const location = useLocation();
  return (
    <div className="min-h-screen bg-[var(--boule-paper)] text-[var(--boule-ink)]">
      <Navigation />
      <CommandPalette />
      <OfflineBanner reconnecting={connection === "reconnecting"} />
      <main>
        <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
