import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Skeleton, ErrorBanner } from "../components/States.tsx";
import { ReportPublic } from "../views/PublicShare/ReportPublic.tsx";
import { MethodologyPublic } from "../views/PublicShare/MethodologyPublic.tsx";
import { Badge, PageHeader, PageShell, Panel } from "../components/Brutalist.tsx";

/** 签名分享只读页（U7/U10）。无登录，先取元数据判 scope，再用对应公开视图渲染。 */
export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["share", token], retry: false,
    queryFn: async () => {
      const res = await fetch(`/s/${token}`);
      if (!res.ok) {
        const code = res.status;
        const msg = code === 410 ? "链接已过期或被撤销" : code === 429 ? "访问过于频繁，请稍后再试" : "链接无效";
        throw new Error(msg);
      }
      return (await res.json()) as { workflowId: string; scope: string };
    },
  });
  const wide = data?.scope === "methodology";
  return (
    <PageShell wide={wide}>
      <PageHeader eyebrow="PUBLIC SHARE" title="Boule · 分享" action={data && <Badge tone="blue">{data.scope}</Badge>}>
        签名只读链接。报告与方法论分享使用与首页一致的公开展示外壳。
      </PageHeader>
      <div className="mt-8">
        {isLoading && <Skeleton rows={3} />}
        {error && <Panel><div className="boule-panel-body space-y-4"><ErrorBanner severity="P0" message={error instanceof Error ? error.message : "无法访问"} /><p className="text-sm text-[#33332e]">链接已过期或被撤销，请联系顾问重新分享。</p></div></Panel>}
        {data && token && data.scope === "report" && <Panel><div className="boule-panel-body"><ReportPublic token={token} /></div></Panel>}
        {data && data.scope === "methodology" && <Panel><div className="boule-panel-body"><MethodologyPublic /></div></Panel>}
      </div>
    </PageShell>
  );
}
