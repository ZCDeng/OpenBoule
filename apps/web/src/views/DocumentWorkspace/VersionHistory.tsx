import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { Skeleton, ErrorBanner } from "../../components/States.tsx";
import { statusLabel } from "../../lib/labels.ts";
import { Badge } from "../../components/Brutalist.tsx";

interface Version { id: string; version: number; status: string; createdAt: string; }

export function VersionHistory({ artifactId, selectedId, onOpen }: { artifactId: string; selectedId?: string; onOpen?: (id: string) => void }) {
  const api = useAuth((s) => s.api);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["versions", artifactId], queryFn: () => api.json<{ versions: Version[] }>(`/api/artifacts/${artifactId}/versions`) });
  if (isLoading) return <Skeleton rows={3} />;
  if (isError) return <ErrorBanner severity="P1" message="版本历史加载失败" onRetry={() => void refetch()} />;
  return (
    <ul className="border-2 border-black text-sm shadow-[4px_4px_0_#0B0B0B]">
      {data!.versions.map((v) => <li key={v.id} className="border-t-2 border-black first:border-t-0"><button onClick={() => onOpen?.(v.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-black hover:text-white"><span className="font-[var(--boule-mono)] text-xs">v{v.version}</span><span className="text-xs opacity-70">{statusLabel(v.status)}</span>{v.id === selectedId && <Badge tone="blue">当前</Badge>}<span className="ml-auto font-[var(--boule-mono)] text-[10px] opacity-60">{new Date(v.createdAt).toLocaleString("zh-CN")}</span></button></li>)}
    </ul>
  );
}
