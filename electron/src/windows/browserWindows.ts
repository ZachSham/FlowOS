import { BrowserWindow } from "electron";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rendererUrl = process.env.FLOWOS_RENDERER_URL ?? "http://127.0.0.1:5173";
const windowModuleDir = dirname(fileURLToPath(import.meta.url));
const preloadPath = resolve(windowModuleDir, "../preload.cjs");
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rendererUrl = process.env.FLOWOS_RENDERER_URL ?? "http://127.0.0.1:5173";
const currentDir = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(currentDir, "..", "preload.cjs");

function resolveRendererEntry(view: "main" | "sidebar") {
  return `${rendererUrl}?view=${view}`;
}

export function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 860,
    height: 760,
    minWidth: 720,
    minHeight: 620,
    title: "FlowOS",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  void mainWindow.loadURL(rendererUrl);
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
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  void sidebarWindow.loadURL(resolveRendererEntry("sidebar"));
  return sidebarWindow;
}
