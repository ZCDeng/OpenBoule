import type { ReactNode } from "react";
import { Navigation } from "./Navigation.tsx";
import { OfflineBanner } from "./States.tsx";
import { useWorkflow } from "../stores/workflow.ts";

export function Layout({ children }: { children: ReactNode }) {
  const connection = useWorkflow((s) => s.connection);
  return (
    <div className="min-h-screen bg-[var(--boule-paper)] text-[var(--boule-ink)]">
      <Navigation />
      <OfflineBanner reconnecting={connection === "reconnecting"} />
      <main>{children}</main>
    </div>
  );
}
