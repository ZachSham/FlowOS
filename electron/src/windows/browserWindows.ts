import { BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rendererUrl = process.env.FLOWOS_RENDERER_URL ?? "http://127.0.0.1:5173";
const thisDir = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(thisDir, "..", "preload.js");

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
      preload: preloadPath,
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
    maxWidth: 420,
    title: "FlowOS Sidebar",
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  void sidebarWindow.loadURL(resolveRendererEntry("sidebar"));
  return sidebarWindow;
}
