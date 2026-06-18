# @boule/desktop — Boule 本地 macOS app 外壳（Electron）

把 P1 做出的「零基础设施后端」（`MODE=local` + PGlite + 进程内队列 + 内存安全集）拉起，同源加载 web，
桥接系统通知，退出时优雅关停。**用户无需 docker / Node / Postgres / Redis。**

## 运行时编排（main.js）

1. 取空闲端口 → 解析用户数据目录（PGlite 落 `app.getPath('userData')/pglite`，跨重启持久）。
2. 跑迁移（幂等）→ 起后端 → 轮询 `/health` → 开窗口 `loadURL(127.0.0.1:port/)`。
3. 注入 env：`MODE=local DB_DRIVER=pglite QUEUE_DRIVER=inproc PGLITE_DATA_DIR=… WEB_DIST_PATH=…`。
4. `before-quit` 给后端发 SIGTERM（server.ts 优雅关停：关引擎 + `closeDb()`）。
5. 系统通知：renderer 经 `preload.js` 暴露的 `window.boule.notify(title, body)` 弹 macOS 原生通知。

## dev

```bash
pnpm --filter @boule/web build      # 先产 web/dist（main.js 同源托管它）
pnpm --filter @boule/desktop dev    # electron . —— 用系统 node 跑 apps/api 的 .ts（Node ≥22 原生剥类型）
```

> 注：dev 用系统 `node` 跑后端 `.ts`，依赖 Node 25 的类型剥离。

## 打包成 .dmg（P2 剩余工作）

Electron 内置 Node 不剥 TS，故打包前需把 `apps/api` 编译成 JS：

1. **编译 api → JS**（待加：esbuild bundle `src/server.ts` + `src/db/migrate.ts` → `apps/api/dist`，
   external 原生模块 pdfjs/pglite；迁移 SQL 文件随包）。
2. `pnpm --filter @boule/web build` → `apps/web/dist`。
3. `electron-builder`（package.json `build` 段已配 appId / extraResources 把 web 和 api 放进 resources）。
4. 签名 / 公证：需 Apple 开发者证书；先出未签名本地可运行版，签名后续接。

packaged 时 `main.js` 用 `process.execPath + ELECTRON_RUN_AS_NODE` 跑 `resources/api` 下的编译产物，
web 取 `resources/web`。

## 验证状态

- ✅ 后端零基础设施整机（migrate + 启动 + `/health` + 同源托管 SPA + 优雅关停）已在 P1/P2前置 实测。
- ✅ `main.js` / `preload.js` 语法校验通过。
- ⏳ GUI 启动 + 打包 .dmg：需安装 Electron + 桌面环境，未在当前无头环境验证。
