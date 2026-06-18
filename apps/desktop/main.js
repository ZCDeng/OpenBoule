/**
 * Boule 本地 macOS app 外壳（Electron 主进程）。
 *
 * 职责：把 P1 做出的「零基础设施后端」（MODE=local + pglite + 进程内队列 + 内存安全集）拉起，
 * 同源加载 web，桥接系统通知，退出时优雅关停。
 *
 * 运行时编排：
 *   1. 解析用户数据目录（PGlite 落 app.getPath('userData')/pglite，跨重启持久）。
 *   2. 跑迁移（幂等）→ 起后端 → 轮询 /health → 开窗口 loadURL(127.0.0.1:port)。
 *   3. 窗口失焦时若有 phase 完成/待审批，可经 IPC 弹原生通知（renderer 触发）。
 *   4. before-quit 杀后端子进程。
 *
 * dev vs packaged：
 *   - dev（未打包）：用系统 node 跑 apps/api 的 .ts（Node 25 原生剥类型）。`pnpm --filter @boule/desktop dev`。
 *   - packaged（.dmg）：需先把 apps/api 编译成 JS（esbuild/tsc，TODO），随包放 resources/api，
 *     主进程用 process.execPath + ELECTRON_RUN_AS_NODE 跑编译产物（Electron 内置 Node 不剥 TS）。
 */

const { app, BrowserWindow, Notification, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const fs = require("node:fs");

const isPackaged = app.isPackaged;
const repoRoot = path.resolve(__dirname, "..", ".."); // apps/desktop → repo 根

let backend = null;
let win = null;
let apiPort = 0;

/** 取一个空闲端口（本地 app 不固定端口，避免与其它进程撞）。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** 解析后端运行方式：dev=系统 node 跑 .ts；packaged=Electron 内置 Node 跑编译 JS。 */
function backendInvocation(scriptRelFromApiSrc) {
  if (isPackaged) {
    const apiDir = path.join(process.resourcesPath, "api");
    return {
      cmd: process.execPath,
      args: [path.join(apiDir, scriptRelFromApiSrc.replace(/\.ts$/, ".js"))],
      runAsNode: true,
      webDist: path.join(process.resourcesPath, "web"),
      cwd: apiDir,
    };
  }
  return {
    cmd: "node",
    args: [path.join(repoRoot, "apps", "api", "src", scriptRelFromApiSrc)],
    runAsNode: false,
    webDist: path.join(repoRoot, "apps", "web", "dist"),
    cwd: repoRoot,
  };
}

function backendEnv(extra) {
  const pgliteDir = path.join(app.getPath("userData"), "pglite");
  fs.mkdirSync(pgliteDir, { recursive: true });
  const base = {
    ...process.env,
    MODE: "local",
    DB_DRIVER: "pglite",
    QUEUE_DRIVER: "inproc",
    PGLITE_DATA_DIR: pgliteDir,
    NODE_ENV: "production",
    AGENT_MODEL: process.env.AGENT_MODEL || "claude-opus-4-8",
  };
  if (extra && extra.runAsNode) base.ELECTRON_RUN_AS_NODE = "1";
  return base;
}

/** 跑迁移（幂等），resolve 表示成功。 */
function runMigrations() {
  const inv = backendInvocation("db/migrate.ts");
  return new Promise((resolve, reject) => {
    const child = spawn(inv.cmd, inv.args, { env: backendEnv(inv), cwd: inv.cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`迁移退出码 ${code}`))));
  });
}

/** 起后端 server，注入端口 + WEB_DIST_PATH。 */
function startBackend() {
  const inv = backendInvocation("server.ts");
  const env = backendEnv(inv);
  env.API_PORT = String(apiPort);
  env.WEB_DIST_PATH = inv.webDist;
  backend = spawn(inv.cmd, inv.args, { env, cwd: inv.cwd, stdio: "inherit" });
  backend.on("exit", (code) => {
    backend = null;
    if (code && code !== 0 && !app.isQuitting) {
      console.error(`[boule-desktop] 后端异常退出 code=${code}`);
    }
  });
}

/** 轮询 /health 直到就绪或超时。 */
function waitHealthy(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port: apiPort, path: "/health", timeout: 1500 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) return reject(new Error("后端 /health 就绪超时"));
      setTimeout(tick, 250);
    };
    tick();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    titleBarStyle: "hiddenInset", // macOS 原生感
    backgroundColor: "#fbfaf6",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(`http://127.0.0.1:${apiPort}/`);
  // 外链走系统浏览器，不在 app 内开新窗。
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

// renderer 经 preload 触发系统通知（前后台状态/消息通知交互的原生承接）。
ipcMain.handle("boule:notify", (_e, { title, body } = {}) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title: String(title || "Boule"), body: String(body || "") });
  n.on("click", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  n.show();
  return true;
});

// 单实例：第二次启动聚焦已有窗口。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      apiPort = await freePort();
      await runMigrations();
      startBackend();
      await waitHealthy();
      createWindow();
    } catch (err) {
      console.error("[boule-desktop] 启动失败：", err);
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && apiPort) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (backend) {
    backend.kill("SIGTERM"); // server.ts 收 SIGTERM 优雅关停（关引擎 + closeDb）
  }
});
