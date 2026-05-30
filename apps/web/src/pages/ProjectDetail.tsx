import { useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { ErrorBanner } from "../components/States.tsx";

const MODES = ["决策", "培训", "落地", "调研", "诊断"] as const;

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const api = useAuth((s) => s.api);
  const nav = useNavigate();

  const start = useMutation({
    mutationFn: (mode: string) =>
      api.json<{ workflowId: string }>("/api/workflows", { method: "POST", body: JSON.stringify({ projectId: id, mode }) }),
    onSuccess: (r) => nav(`/workflows/${r.workflowId}`),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl">项目工作流</h1>
      <p className="text-sm text-neutral-500">选择 mode 启动一次新的咨询工作流（仅 Owner 可启动）。</p>
      {start.isError && <ErrorBanner severity="P0" message="启动工作流失败（可能权限不足或真值源未配置）" />}
      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m}
            disabled={start.isPending}
            onClick={() => start.mutate(m)}
            className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}
