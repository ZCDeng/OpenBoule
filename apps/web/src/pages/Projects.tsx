import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { Skeleton, EmptyState, ErrorBanner } from "../components/States.tsx";

interface Project {
  id: string;
  name: string;
}

export function ProjectsPage() {
  const api = useAuth((s) => s.api);
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.json<{ projects: Project[] }>("/api/projects"),
  });

  const create = useMutation({
    mutationFn: (n: string) => api.json<{ projectId: string }>("/api/projects", { method: "POST", body: JSON.stringify({ name: n }) }),
    onSuccess: () => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl">项目</h1>
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()); }}
          className="flex gap-2"
        >
          <input className="rounded border border-neutral-300 px-3 py-1 text-sm" placeholder="新项目名" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50" disabled={create.isPending}>
            创建
          </button>
        </form>
      </div>

      {isLoading && <Skeleton rows={4} />}
      {isError && <ErrorBanner severity="P0" message="加载项目失败" onRetry={() => void refetch()} />}
      {data && data.projects.length === 0 && (
        <EmptyState title="还没有项目" hint="创建第一个项目，开始一次咨询工作流。" />
      )}
      {data && data.projects.length > 0 && (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {data.projects.map((p) => (
            <li key={p.id}>
              <Link to={`/projects/${p.id}`} className="block px-4 py-3 hover:bg-neutral-50">
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
