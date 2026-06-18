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

## 打包成 .dmg（在 Mac 上跑）

Electron 内置 Node 不剥 TS，故打包前把 `apps/api` 编成 JS。**编译这步已做好并实测**
（`apps/api/scripts/build.mjs`：esbuild 只 bundle 我们的 src，npm 依赖标 external，运行时从 node_modules 加载；
迁移 SQL 复制到 `dist/db/migrations`）。`node dist/server.js` / `node dist/db/migrate.js` 在 local-app 模式已验证可跑。

一条命令（已配 `pnpm --filter @boule/desktop dist`）：
```bash
pnpm --filter @boule/desktop dist   # = build:web + build:api(esbuild) + electron-builder
```

### pnpm node_modules 注意（打包前必做）

`packages: external` 意味着 `resources/api/node_modules` 要有**真实扁平**的依赖（含 WASM/原生：pglite/pdfjs/
liteparse），但 pnpm 的 `apps/api/node_modules` 是指向根 `.pnpm` store 的符号链接农场，直接拷不全。
electron-builder 前先生成扁平 node_modules，二选一：

- `pnpm --filter @boule/api deploy --prod apps/api/.deploy`（产扁平 node_modules），再把
  `build.extraResources` 的 `../api/node_modules` 指到 `../api/.deploy/node_modules`；或
- 仓库根 `.npmrc` 设 `node-linker=hoisted` 后重装，使 `apps/api/node_modules` 变扁平可直接拷。

> 当前 `extraResources` 指 `../api/node_modules`，扁平化处理后即可直接打包。

### 签名 / 公证

需 Apple 开发者证书（`CSC_LINK` / `CSC_KEY_PASSWORD` + notarize 配置）。先出未签名本地可运行版验证流程，
签名在证书就绪后补 `build.mac.notarize`。

packaged 时 `main.js` 用 `process.execPath + ELECTRON_RUN_AS_NODE` 跑 `resources/api/server.js`（迁移 `db/migrate.js`），
web 取 `resources/web`。node_modules 解析：server.js 在 `resources/api/` 向上找到 `resources/api/node_modules`。

## 验证状态

- ✅ 后端零基础设施整机（migrate + 启动 + `/health` + 同源托管 SPA + 优雅关停）已在 P1/P2前置 实测。
- ✅ `main.js` / `preload.js` 语法校验通过。
- ⏳ GUI 启动 + 打包 .dmg：需安装 Electron + 桌面环境，未在当前无头环境验证。
