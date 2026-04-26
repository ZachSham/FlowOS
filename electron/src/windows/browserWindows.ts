import { BrowserWindow, session } from "electron";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rendererUrl = process.env.FLOWOS_RENDERER_URL ?? "http://127.0.0.1:5173";
const windowModuleDir = dirname(fileURLToPath(import.meta.url));
const preloadPath = resolve(windowModuleDir, "../preload.cjs");

export function createMainWindow(options?: { show?: boolean }) {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });

  const mainWindow = new BrowserWindow({
    width: 860,
    height: 760,
    minWidth: 720,
    minHeight: 620,
    title: "FlowOS",
    show: options?.show ?? true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  void mainWindow.loadURL(rendererUrl);
  return mainWindow;
}
