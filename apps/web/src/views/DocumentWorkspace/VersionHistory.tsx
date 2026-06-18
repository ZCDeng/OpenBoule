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
    <ul className="boule-list text-sm">
      {data!.versions.map((v) => <li key={v.id}><button onClick={() => onOpen?.(v.id)} className={`boule-list-row w-full justify-start gap-2 text-left ${v.id === selectedId ? "boule-list-row--selected" : ""}`}><span className="text-xs font-medium">v{v.version}</span><span className="text-xs text-[var(--md-on-surface-variant)]">{statusLabel(v.status)}</span>{v.id === selectedId && <Badge tone="blue">当前</Badge>}<span className="ml-auto text-[11px] text-[var(--md-on-surface-variant)]">{new Date(v.createdAt).toLocaleString("zh-CN")}</span></button></li>)}
    </ul>
  );
}
