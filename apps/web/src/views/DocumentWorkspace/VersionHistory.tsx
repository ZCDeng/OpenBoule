/**
 * 版本历史（U9）。列某 artifact 的所有版本（支撑 R3 历史版本喂下游）。
 */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { Skeleton, ErrorBanner } from "../../components/States.tsx";

interface Version {
  id: string;
  version: number;
  status: string;
  createdAt: string;
}

export function VersionHistory({ artifactId, selectedId, onOpen }: { artifactId: string; selectedId?: string; onOpen?: (id: string) => void }) {
  const api = useAuth((s) => s.api);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["versions", artifactId],
    queryFn: () => api.json<{ versions: Version[] }>(`/api/artifacts/${artifactId}/versions`),
  });

  if (isLoading) return <Skeleton rows={3} />;
  if (isError) return <ErrorBanner severity="P1" message="版本历史加载失败" onRetry={() => void refetch()} />;

  return (
    <ul className="space-y-1 text-sm">
      {data!.versions.map((v) => (
        <li key={v.id}>
          <button onClick={() => onOpen?.(v.id)} className="flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-neutral-50">
            <span className="font-mono text-xs">v{v.version}</span>
            <span className="text-xs text-neutral-400">{v.status}</span>
            {v.id === selectedId && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">当前</span>}
            <span className="ml-auto text-xs text-neutral-400">{new Date(v.createdAt).toLocaleString("zh-CN")}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
