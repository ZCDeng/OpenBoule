import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../stores/auth.ts";
import { Layout } from "../components/Layout.tsx";
import { LoginPage } from "../pages/Login.tsx";
import { LandingPage } from "../pages/Landing.tsx";
import { ProjectsPage } from "../pages/Projects.tsx";
import { ProjectDetailPage } from "../pages/ProjectDetail.tsx";
import { WorkflowPage } from "../pages/Workflow.tsx";
import { MethodologyPage } from "../pages/Methodology.tsx";
import { SettingsPage } from "../pages/Settings.tsx";
import { SharePage } from "../pages/Share.tsx";

/** 未登录跳 /login（保留 6 态之「权限不足」由各页处理，这里只挡未认证）。 */
function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthed = useAuth((s) => s.isAuthed());
  return isAuthed ? <Layout>{children}</Layout> : <Navigate to="/login" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/s/:token" element={<SharePage />} />
      <Route path="/projects" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
      <Route path="/projects/:id" element={<RequireAuth><ProjectDetailPage /></RequireAuth>} />
      <Route path="/workflows/:id" element={<RequireAuth><WorkflowPage /></RequireAuth>} />
      <Route path="/methodology" element={<RequireAuth><MethodologyPage /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
