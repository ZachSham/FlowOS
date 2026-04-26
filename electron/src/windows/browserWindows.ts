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
    width: 340,
    height: 420,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    show: options?.show ?? false,
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
