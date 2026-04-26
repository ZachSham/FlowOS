import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import {
  demoSuggestions,
  demoTaskState,
  type ChromeCommand,
  type ChromeCommandPayloadMap,
  type ChromeCommandResultMap,
  type ChromeSnapshot,
  type Suggestion,
  type TaskState,
  type TaskSignal,
  type VsCodeSnapshot
} from "@flowos/shared";
import { ipcChannels } from "./ipc/channels.js";
import { createRealtimeServer, type RealtimeServerHandle } from "./realtime/server.js";
import { startSwiftHelperBridge, type SwiftHelperStatus } from "./bridge/swiftHelper.js";
import { startElectronObservationService } from "./telemetry/electronObservationService.js";
import { startNativeHelperTelemetry } from "./telemetry/nativeHelperTelemetry.js";
import { AnthropicFlowOrchestrator, type FlowRunResult } from "./services/anthropicFlowOrchestrator.js";
import { loadDotEnv } from "./services/loadEnv.js";
import { TrackingSession } from "./services/trackingSession.js";
import { createMainWindow } from "./windows/browserWindows.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMainWindow, createSidebarWindow } from "./windows/browserWindows.js";
import { createChromeHistoryStore, type ChromeHistoryStore } from "./realtime/chromeHistoryStore.js";
import { createChromeEditor, type ChromeEditor } from "./actions/chromeEditor.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadDotEnv(repoRoot);
const port = Number(process.env.FLOWOS_WS_PORT ?? "7331");

let taskState: TaskState = demoTaskState;
let suggestions: Suggestion[] = demoSuggestions;
let mainWindow: Electron.BrowserWindow | null = null;
let observationService: Awaited<ReturnType<typeof startElectronObservationService>> | null = null;
let nativeHelperBridge: Awaited<ReturnType<typeof startSwiftHelperBridge>> | null = null;
let nativeHelperTelemetry: Awaited<ReturnType<typeof startNativeHelperTelemetry>> | null = null;
let realtimeServer: RealtimeServerHandle | null = null;
let chromeEditor: ChromeEditor | null = null;
let chromeHistoryStore: ChromeHistoryStore | null = null;
let latestChromeSnapshot: ChromeSnapshot | null = null;
let latestVsCodeSnapshot: VsCodeSnapshot | null = null;
let swiftHelperStatus: SwiftHelperStatus = {
  connected: false,
  transport: "stdio",
  command: []
};
const trackingSession = new TrackingSession();
let lastFlowRun: FlowRunResult | null = null;
let flowModeStatus: "idle" | "running" | "completed" | "failed" = "idle";

async function bootstrap() {
  const authToken = process.env.FLOWOS_EXTENSION_TOKEN?.trim();
  chromeHistoryStore = await createChromeHistoryStore(
    join(app.getPath("userData"), "chrome-snapshots.jsonl")
  );
  latestChromeSnapshot = chromeHistoryStore.getLatest();

  realtimeServer = createRealtimeServer(port, {
    authToken,
    onChromeSnapshot: (snapshot) => {
      latestChromeSnapshot = snapshot;
      void chromeHistoryStore?.append(snapshot);
      refreshTaskStateFromSignals();
      broadcastStateUpdate();
    },
    onVsCodeSnapshot: (snapshot) => {
      latestVsCodeSnapshot = snapshot;
      refreshTaskStateFromSignals();
      broadcastStateUpdate();
    }
  });

  chromeEditor = createChromeEditor(async (command, payload) => {
    if (!realtimeServer) {
      throw new Error("Realtime server not initialized");
    }

    return await realtimeServer.requestChromeCommand(command, payload);
  });

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
    realtimeClients: realtimeServer?.getConnectedClients() ?? [],
    chrome: {
      latestSnapshot: latestChromeSnapshot,
      historyPreview: chromeHistoryStore?.getRecent(5) ?? []
    }
  }));

  ipcMain.handle(ipcChannels.runChromeCommand, async (_event, request: ChromeCommandInvocation) => {
    return await runChromeCommand(request.command, request.payload);
  });

  mainWindow = createMainWindow();
  sidebarWindow = createSidebarWindow();
  attachPreloadDiagnostics(mainWindow, "main");
  attachPreloadDiagnostics(sidebarWindow, "sidebar");
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
  realtimeServer?.stop();
  nativeHelperTelemetry?.stop();
  nativeHelperBridge?.stop();
  observationService?.stop();
});

type ChromeCommandInvocation<C extends ChromeCommand = ChromeCommand> = {
  command: C;
  payload: ChromeCommandPayloadMap[C];
};

async function runChromeCommand<C extends ChromeCommand>(
  command: C,
  payload: ChromeCommandPayloadMap[C]
): Promise<ChromeCommandResultMap[C]> {
  if (!chromeEditor) {
    throw new Error("Chrome editor not initialized");
  }

  switch (command) {
    case "chrome.tab.focus":
      return (await chromeEditor.focusTab((payload as ChromeCommandPayloadMap["chrome.tab.focus"]).tabId)) as ChromeCommandResultMap[C];
    case "chrome.tabs.group":
      return (await chromeEditor.groupTabs(payload as ChromeCommandPayloadMap["chrome.tabs.group"])) as ChromeCommandResultMap[C];
    case "chrome.tabs.ungroup":
      return (await chromeEditor.ungroupTabs((payload as ChromeCommandPayloadMap["chrome.tabs.ungroup"]).tabIds)) as ChromeCommandResultMap[C];
    case "chrome.tab.pin":
      return (await chromeEditor.pinTab(
        (payload as ChromeCommandPayloadMap["chrome.tab.pin"]).tabId,
        (payload as ChromeCommandPayloadMap["chrome.tab.pin"]).pinned
      )) as ChromeCommandResultMap[C];
    case "chrome.tabs.close":
      return (await chromeEditor.closeTabs((payload as ChromeCommandPayloadMap["chrome.tabs.close"]).tabIds)) as ChromeCommandResultMap[C];
    case "chrome.tab.open":
      return (await chromeEditor.openTab(payload as ChromeCommandPayloadMap["chrome.tab.open"])) as ChromeCommandResultMap[C];
  }

  throw new Error(`Unsupported chrome command: ${String(command)}`);
}

function refreshTaskStateFromSignals() {
  const signals: TaskSignal[] = [];

  if (latestVsCodeSnapshot?.activeFile) {
    signals.push({
      source: "vscode-extension",
      label: "Active file",
      value: latestVsCodeSnapshot.activeFile,
      weight: 0.86
    });
  }

  if (latestChromeSnapshot) {
    const activeTab = latestChromeSnapshot.tabs.find((tab) => tab.active);
    if (activeTab) {
      signals.push({
        source: "chrome-extension",
        label: "Active tab",
        value: activeTab.title || activeTab.url,
        weight: 0.72
      });
    }
  }

  if (signals.length === 0) {
    return;
  }

  taskState = {
    ...taskState,
    updatedAt: new Date().toISOString(),
    signals
  };
}

function broadcastStateUpdate() {
  const payload = {
    taskState,
    suggestions
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(ipcChannels.stateUpdated, payload);
  }

  if (sidebarWindow && !sidebarWindow.isDestroyed()) {
    sidebarWindow.webContents.send(ipcChannels.stateUpdated, payload);
  }
}

function attachPreloadDiagnostics(window: Electron.BrowserWindow | null, label: string) {
  if (!window) {
    return;
  }

  window.webContents.on("did-finish-load", () => {
    void window.webContents
      .executeJavaScript("typeof window.flowos")
      .then((value) => {
        console.log(`[flowos][preload] ${label} window.flowos = ${String(value)}`);
      })
      .catch((error) => {
        console.error(`[flowos][preload] ${label} probe failed`, error);
      });
  });
}
