import { app, BrowserWindow, ipcMain } from "electron";
import { demoSuggestions, demoTaskState, type Suggestion, type TaskState } from "@flowos/shared";
import { ipcChannels } from "./ipc/channels.js";
import { createRealtimeServer } from "./realtime/server.js";
import { startSwiftHelperBridge, type SwiftHelperStatus } from "./bridge/swiftHelper.js";
import { startElectronObservationService } from "./telemetry/electronObservationService.js";
import { startNativeHelperTelemetry } from "./telemetry/nativeHelperTelemetry.js";
import { AnthropicFlowOrchestrator, type FlowRunResult } from "./services/anthropicFlowOrchestrator.js";
import { loadDotEnv } from "./services/loadEnv.js";
import { TrackingSession } from "./services/trackingSession.js";
import { createMainWindow } from "./windows/browserWindows.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadDotEnv(repoRoot);
const port = Number(process.env.FLOWOS_WS_PORT ?? "7331");

let taskState: TaskState = demoTaskState;
let suggestions: Suggestion[] = demoSuggestions;
let mainWindow: Electron.BrowserWindow | null = null;
let observationService: Awaited<ReturnType<typeof startElectronObservationService>> | null = null;
let nativeHelperBridge: Awaited<ReturnType<typeof startSwiftHelperBridge>> | null = null;
let nativeHelperTelemetry: Awaited<ReturnType<typeof startNativeHelperTelemetry>> | null = null;
let swiftHelperStatus: SwiftHelperStatus = {
  connected: false,
  transport: "stdio",
  command: []
};
const trackingSession = new TrackingSession();
let lastFlowRun: FlowRunResult | null = null;
let flowModeStatus: "idle" | "running" | "completed" | "failed" = "idle";

async function bootstrap() {
  createRealtimeServer(port);
  observationService = await startElectronObservationService();
  nativeHelperBridge = await startSwiftHelperBridge();
  swiftHelperStatus = nativeHelperBridge.getStatus();
  nativeHelperBridge.onEvent((event) => {
    if (event.event === "helper.ready") {
      swiftHelperStatus = nativeHelperBridge?.getStatus() ?? swiftHelperStatus;
    }

    trackingSession.record(event);
  });
  nativeHelperTelemetry = await startNativeHelperTelemetry(nativeHelperBridge);
  const flowOrchestrator = new AnthropicFlowOrchestrator({
    bridge: nativeHelperBridge,
    trackingSession
  });

  ipcMain.handle(ipcChannels.getBootstrapState, () => ({
    taskState,
    suggestions,
    websocketPort: port,
    swiftHelper: swiftHelperStatus,
    tracking: trackingSession.getState(),
    flow: {
      status: flowModeStatus,
      lastRun: lastFlowRun
    }
  }));

  ipcMain.handle(ipcChannels.startTracking, () => {
    return trackingSession.start();
  });

  ipcMain.handle(ipcChannels.enterFlowMode, async () => {
    flowModeStatus = "running";

    try {
      const result = await flowOrchestrator.enterDevelopFlowMode();
      lastFlowRun = result;
      flowModeStatus = result.ok ? "completed" : "failed";
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastFlowRun = {
        ok: false,
        summary: message,
        model: process.env.ANTHROPIC_MODEL ?? null,
        snapshotTimestamp: null,
        toolCalls: [],
        toolResults: []
      };
      flowModeStatus = "failed";
      return lastFlowRun;
    }
  });

  mainWindow = createMainWindow();
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
  }
});

app.on("before-quit", () => {
  nativeHelperTelemetry?.stop();
  nativeHelperBridge?.stop();
  observationService?.stop();
});
