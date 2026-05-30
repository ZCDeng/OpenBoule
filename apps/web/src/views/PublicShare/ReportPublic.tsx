/**
 * 公开报告页（U10）。免登录拉 /s/:token/report（服务端已渲染+sanitize+CSP），塞进隔离 iframe。
 * 区分 410 过期/撤销、403 scope、429 限流。
 */

import { useQuery } from "@tanstack/react-query";
import { ReportViewer } from "../ReportShare/ReportViewer.tsx";
import { Skeleton, ErrorBanner } from "../../components/States.tsx";

export function ReportPublic({ token }: { token: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["public-report", token],
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/s/${token}/report`);
      if (!res.ok) {
        const msg =
          res.status === 410 ? "链接已过期或被撤销" : res.status === 403 ? "链接无权访问此内容" : res.status === 429 ? "访问过于频繁，请稍后再试" : "链接无效";
        throw new Error(msg);
      }
      return res.text();
    },
  });

  if (isLoading) return <Skeleton rows={5} />;
  if (error) return <ErrorBanner severity="P0" message={error instanceof Error ? error.message : "无法访问"} />;
  return <ReportViewer html={data!} />;
}
