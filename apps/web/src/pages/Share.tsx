import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Skeleton, ErrorBanner } from "../components/States.tsx";

/** 签名分享只读页（U7）。无登录，直接打 /s/:token；区分 410 过期 / 404 / 429 限流。 */
export function SharePage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["share", token],
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/s/${token}`);
      if (!res.ok) {
        const code = res.status;
        const msg = code === 410 ? "链接已过期" : code === 429 ? "访问过于频繁，请稍后再试" : "链接无效或已撤销";
        throw new Error(msg);
      }
      return (await res.json()) as { workflowId: string; scope: string };
    },
  });

  return (
    <div className="mx-auto mt-24 max-w-lg px-6">
      <h1 className="mb-6 text-2xl">Boule · 分享</h1>
      {isLoading && <Skeleton rows={3} />}
      {error && <ErrorBanner severity="P0" message={error instanceof Error ? error.message : "无法访问"} />}
      {data && (
        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          <p className="text-sm text-neutral-500">scope：{data.scope}</p>
          <p className="mt-2">只读内容将在此呈现（{data.scope === "methodology" ? "方法论演示" : "报告"}）。</p>
        </div>
      )}
    </div>
  );
}
