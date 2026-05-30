import type { ReactNode } from "react";
import { Navigation } from "./Navigation.tsx";
import { OfflineBanner } from "./States.tsx";
import { useWorkflow } from "../stores/workflow.ts";

export function Layout({ children }: { children: ReactNode }) {
  const connection = useWorkflow((s) => s.connection);
  return (
    <div className="min-h-screen">
      <Navigation />
      <OfflineBanner reconnecting={connection === "reconnecting"} />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
