import { BrowserWindow } from "electron";
import { join } from "node:path";

const rendererUrl = process.env.FLOWOS_RENDERER_URL ?? "http://127.0.0.1:5173";

function resolveRendererEntry(view: "main" | "sidebar") {
  return `${rendererUrl}?view=${view}`;
}

export function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: "FlowOS",
    webPreferences: {
      preload: join(process.cwd(), "electron", "dist", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  void mainWindow.loadURL(resolveRendererEntry("main"));
  return mainWindow;
}

export function createSidebarWindow() {
  const sidebarWindow = new BrowserWindow({
    width: 360,
    height: 860,
    minWidth: 320,
    maxWidth: 900,
    minHeight: 520,
    title: "FlowOS Sidebar",
    frame: true,
    transparent: false,
    alwaysOnTop: false,
    movable: true,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    hasShadow: true,
    skipTaskbar: false,
    webPreferences: {
      preload: join(process.cwd(), "electron", "dist", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  void sidebarWindow.loadURL(resolveRendererEntry("sidebar"));
  return sidebarWindow;
}
