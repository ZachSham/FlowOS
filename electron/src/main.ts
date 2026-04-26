import { app, BrowserWindow, ipcMain } from "electron";
import { demoSuggestions, demoTaskState, type Suggestion, type TaskState } from "@flowos/shared";
import { ipcChannels } from "./ipc/channels.js";
import { createRealtimeServer } from "./realtime/server.js";
import { startSwiftHelperBridge, type SwiftHelperStatus } from "./bridge/swiftHelper.js";
import { startElectronObservationService } from "./telemetry/electronObservationService.js";
import { startNativeHelperTelemetry } from "./telemetry/nativeHelperTelemetry.js";
import { createMainWindow, createSidebarWindow } from "./windows/browserWindows.js";

const port = Number(process.env.FLOWOS_WS_PORT ?? "7331");

let taskState: TaskState = demoTaskState;
let suggestions: Suggestion[] = demoSuggestions;
let mainWindow: Electron.BrowserWindow | null = null;
let sidebarWindow: Electron.BrowserWindow | null = null;
let observationService: Awaited<ReturnType<typeof startElectronObservationService>> | null = null;
let nativeHelperBridge: Awaited<ReturnType<typeof startSwiftHelperBridge>> | null = null;
let nativeHelperTelemetry: Awaited<ReturnType<typeof startNativeHelperTelemetry>> | null = null;
let swiftHelperStatus: SwiftHelperStatus = {
  connected: false,
  transport: "stdio",
  command: []
};

async function bootstrap() {
  createRealtimeServer(port);
  observationService = await startElectronObservationService();
  nativeHelperBridge = await startSwiftHelperBridge();
  swiftHelperStatus = nativeHelperBridge.getStatus();
  nativeHelperBridge.onEvent((event) => {
    if (event.event === "helper.ready") {
      swiftHelperStatus = nativeHelperBridge?.getStatus() ?? swiftHelperStatus;
    }
  });
  nativeHelperTelemetry = await startNativeHelperTelemetry(nativeHelperBridge);

  ipcMain.handle(ipcChannels.getBootstrapState, () => ({
    taskState,
    suggestions,
    websocketPort: port,
    swiftHelper: swiftHelperStatus
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
  nativeHelperTelemetry?.stop();
  nativeHelperBridge?.stop();
  observationService?.stop();
});
