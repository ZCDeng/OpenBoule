import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Skeleton, ErrorBanner } from "../components/States.tsx";
import { ReportPublic } from "../views/PublicShare/ReportPublic.tsx";
import { MethodologyPublic } from "../views/PublicShare/MethodologyPublic.tsx";

/** 签名分享只读页（U7/U10）。无登录，先取元数据判 scope，再用对应公开视图渲染。 */
export function SharePage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["share", token],
    retry: false,
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
    <div className={`mx-auto px-6 ${wide ? "mt-8 max-w-5xl" : "mt-16 max-w-3xl"}`}>
      {isLoading && <Skeleton rows={3} />}
      {error && (
        <div className="mt-12">
          <h1 className="mb-4 text-2xl">Boule · 分享</h1>
          <ErrorBanner severity="P0" message={error instanceof Error ? error.message : "无法访问"} />
          <p className="mt-3 text-sm text-neutral-500">链接已过期或被撤销，请联系顾问重新分享。</p>
        </div>
      )}
      {data && token && data.scope === "report" && <ReportPublic token={token} />}
      {data && data.scope === "methodology" && <MethodologyPublic />}
    </div>
  );
}
