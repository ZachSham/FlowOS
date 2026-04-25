import { app, BrowserWindow, ipcMain } from "electron";
import { ensureDatabase } from "@flowos/db";
import { demoSuggestions, demoTaskState, type Suggestion, type TaskState } from "@flowos/shared";
import { ipcChannels } from "./ipc/channels.js";
import { createRealtimeServer } from "./realtime/server.js";
import { getSwiftHelperStatus } from "./bridge/swiftHelper.js";
import { createMainWindow, createSidebarWindow } from "./windows/browserWindows.js";

const port = Number(process.env.FLOWOS_WS_PORT ?? "7331");

let taskState: TaskState = demoTaskState;
let suggestions: Suggestion[] = demoSuggestions;
let mainWindow: Electron.BrowserWindow | null = null;
let sidebarWindow: Electron.BrowserWindow | null = null;
let db: ReturnType<typeof ensureDatabase> | null = null;

async function bootstrap() {
  db = ensureDatabase();
  createRealtimeServer(port);

  ipcMain.handle(ipcChannels.getBootstrapState, () => ({
    taskState,
    suggestions,
    websocketPort: port,
    swiftHelper: getSwiftHelperStatus()
  }));

  mainWindow = createMainWindow();
  sidebarWindow = createSidebarWindow();
}

app.whenReady().then(() => {
  void bootstrap();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
    sidebarWindow = createSidebarWindow();
  }
});

app.on("before-quit", () => {
  db?.close();
});
