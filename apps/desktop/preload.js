/**
 * 预加载脚本：在隔离上下文里把极小的原生能力安全暴露给 renderer。
 * 目前只开「系统通知」——前端在窗口失焦时可经此弹 macOS 原生通知（前后台状态/消息通知交互）。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boule", {
  /** 弹系统通知。返回是否成功（系统不支持时 false）。 */
  notify: (title, body) => ipcRenderer.invoke("boule:notify", { title, body }),
  /** 标记运行在桌面外壳里（前端可据此启用原生交互分支）。 */
  isDesktop: true,
  platform: process.platform,
});
