import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 前端 dev 把 /api、/s、/health 代理到 Fastify（U6），避免跨域 + cookie 同源。
// 目标端口走 VITE_API_PORT，默认 3000（本地 3000 被占时可覆盖，如 Flowise 占用）。
const apiTarget = `http://localhost:${process.env.VITE_API_PORT ?? "3000"}`;
export default defineConfig({
  base: "/OpenBoule/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // 正则 + 前缀加斜杠：避免 "/s" 误吞 /src/*（vite proxy key 是前缀匹配）。
      "^/api/": { target: apiTarget, changeOrigin: true },
      "^/s/": { target: apiTarget, changeOrigin: true },
      "/health": { target: apiTarget, changeOrigin: true },
    },
  },
});
