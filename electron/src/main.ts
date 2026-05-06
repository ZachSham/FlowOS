import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, net, globalShortcut, screen } from "electron";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDatabase } from "@flowos/db";
import {
  demoSuggestions,
  demoTaskState,
  type ChromeCommand,
  type ChromeCommandPayloadMap,
  type ChromeCommandResultMap,
  type ChromeSnapshot,
  type Suggestion,
  type TaskState,
  type TaskSignal
} from "@flowos/shared";
import { ipcChannels } from "./ipc/channels.js";
import { createRealtimeServer, type RealtimeServerHandle } from "./realtime/server.js";
import { startSwiftHelperBridge, type SwiftHelperStatus } from "./bridge/swiftHelper.js";
import { startElectronObservationService } from "./telemetry/electronObservationService.js";
import { startNativeHelperTelemetry } from "./telemetry/nativeHelperTelemetry.js";
import {
  OpenAIFlowOrchestrator,
  type FlowMode,
  type FlowRunResult
} from "./services/openaiFlowOrchestrator.js";
import { loadDotEnv } from "./services/loadEnv.js";
import { TrackingSession } from "./services/trackingSession.js";
import {
  createPersistentMemoryStore,
  type PersistentMemoryStore
} from "./services/persistentMemoryStore.js";
import { createMainWindow } from "./windows/browserWindows.js";
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
let menuBarTray: Tray | null = null;
let chromeEditor: ChromeEditor | null = null;
let chromeHistoryStore: ChromeHistoryStore | null = null;
let persistentMemoryStore: PersistentMemoryStore | null = null;
let latestChromeSnapshot: ChromeSnapshot | null = null;
let swiftHelperStatus: SwiftHelperStatus = {
  connected: false,
  transport: "stdio",
  command: []
};
const trackingSession = new TrackingSession();
let db: ReturnType<typeof ensureDatabase> | null = null;
let lastFlowRun: FlowRunResult | null = null;
let flowModeStatus: "idle" | "running" | "completed" | "failed" = "idle";
const GLOBAL_MIC_SHORTCUT = "CommandOrControl+Shift+K";

async function bootstrap() {
  const dbPath = process.env.FLOWOS_DB_PATH?.trim() || join(app.getPath("userData"), "flowos.db");
  db = ensureDatabase(dbPath);

  const authToken = process.env.FLOWOS_EXTENSION_TOKEN?.trim();
  const memoryFilePath =
    process.env.FLOWOS_MEMORY_PATH?.trim() || join(app.getPath("desktop"), "flowos-memory.md");
  persistentMemoryStore = await createPersistentMemoryStore(memoryFilePath);
  appendMemoryEntry("flowos.bootstrap", "FlowOS app bootstrap completed.", {
    websocketPort: port,
    memoryFilePath
  });

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
    }
  });

  chromeEditor = createChromeEditor(async (command, payload) => {
    if (!realtimeServer) {
      throw new Error("Realtime server not initialized");
    }

    return await realtimeServer.requestChromeCommand(command, payload);
  });

  observationService = await startElectronObservationService({ trackingSession });
  nativeHelperBridge = await startSwiftHelperBridge();
  swiftHelperStatus = nativeHelperBridge.getStatus();
  nativeHelperBridge.onEvent((event) => {
    if (event.event === "helper.ready") {
      swiftHelperStatus = nativeHelperBridge?.getStatus() ?? swiftHelperStatus;
    }

    trackingSession.record(event);
  });
  nativeHelperTelemetry = await startNativeHelperTelemetry(nativeHelperBridge);
  const flowOrchestrator = new OpenAIFlowOrchestrator({
    bridge: nativeHelperBridge,
    trackingSession,
    getChromeSnapshot: () => latestChromeSnapshot,
    runChromeCommand,
    getMemory: () => persistentMemoryStore?.getSnapshot().recentEntries ?? []
  });

  const runEnterFlowMode = async (mode: FlowMode) => {
    flowModeStatus = "running";
    appendMemoryEntry("flow.mode.start", `Entered flow mode run (${mode}).`, { mode });
    refreshMenuBar();

    try {
      const result = await flowOrchestrator.enterFlowMode(mode);
      lastFlowRun = result;
      flowModeStatus = result.ok ? "completed" : "failed";
      if (result.ok) {
        const appsActedOn = [...new Set(result.toolCalls.map((t) => t.input["bundleId"] ?? t.input["windowId"]).filter(Boolean))];
        appendMemoryEntry(
          "flow.mode.completed",
          `${mode} mode: ${result.summary}`,
          { mode, model: result.model, appsActedOn, toolCallCount: result.toolCalls.length }
        );
      } else {
        appendMemoryEntry("flow.mode.failed", result.summary, { mode });
      }
      if (result.errorCode === "tracking-required") {
        void dialog.showMessageBox({
          type: "warning",
          title: "Tracking required",
          message: "Tracking required",
          detail: result.summary,
          buttons: ["OK"],
          defaultId: 0
        });
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastFlowRun = {
        ok: false,
        summary: message,
        model: process.env.OPENAI_MODEL ?? null,
        snapshotTimestamp: null,
        toolCalls: [],
        toolResults: []
      };
      flowModeStatus = "failed";
      appendMemoryEntry("flow.mode.failed", message, { mode });
      return lastFlowRun;
    } finally {
      refreshMenuBar();
    }
  };

  const startTracking = () => {
    const tracking = trackingSession.start();
    refreshMenuBar();
    return tracking;
  };

  ipcMain.handle(ipcChannels.getBootstrapState, () => ({
    taskState,
    suggestions,
    websocketPort: port,
    swiftHelper: swiftHelperStatus,
    tracking: trackingSession.getState(),
    flow: {
      status: flowModeStatus,
      lastRun: lastFlowRun
    },
    memory: persistentMemoryStore?.getSnapshot() ?? null,
    realtimeClients: realtimeServer?.getConnectedClients() ?? [],
    chrome: {
      latestSnapshot: latestChromeSnapshot,
      historyPreview: chromeHistoryStore?.getRecent(5) ?? []
    }
  }));

  ipcMain.handle(ipcChannels.showWindow, () => {
    const win = ensureBackgroundWindow();
    win.show();
    win.focus();
  });

  ipcMain.handle(ipcChannels.hideWindow, () => {
    mainWindow?.hide();
  });

  ipcMain.handle(ipcChannels.startTracking, () => {
    return startTracking();
  });

  ipcMain.handle(ipcChannels.enterFlowMode, async (_event, payload: { mode?: FlowMode } | undefined) => {
    const mode: FlowMode = payload?.mode === "research" ? "research" : "coding";
    return await runEnterFlowMode(mode);
  });

  ipcMain.handle(ipcChannels.runVoiceCommand, async (_event, transcript: string) => {
    appendMemoryEntry("voice.command.start", `Voice command started: "${transcript}"`);
    const result = await flowOrchestrator.runVoiceCommand(transcript);
    appendMemoryEntry(
      result.ok ? "voice.command.completed" : "voice.command.failed",
      result.summary,
      {
        transcript,
        model: result.model,
        snapshotTimestamp: result.snapshotTimestamp,
        toolCalls: result.toolCalls,
        toolResults: result.toolResults
      }
    );
    return result;
  });

  ipcMain.handle(ipcChannels.transcribeAudio, async (_event, audioData: Uint8Array) => {
    const apiKey = process.env["OPENAI_API_KEY"]?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

    const form = new FormData();
    const audioBuffer = audioData.buffer.slice(
      audioData.byteOffset,
      audioData.byteOffset + audioData.byteLength
    ) as ArrayBuffer;
    form.append("model", "whisper-1");
    form.append(
      "file",
      new Blob([audioBuffer], { type: "audio/webm" }),
      "recording.webm"
    );

    const response = await net.fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Whisper error ${response.status}: ${text}`);
    }

    const data = await response.json() as { text: string };
    return data.text.trim();
  });

  ipcMain.handle(ipcChannels.runChromeCommand, async (_event, request: ChromeCommandInvocation) => {
    return await runChromeCommand(request.command, request.payload);
  });

  function ensureBackgroundWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow({ show: false });
      mainWindow.on("blur", () => {
        mainWindow?.hide();
      });
    }

    return mainWindow;
  }

  function sendTrayAction(action: "toggle-mic") {
    const backgroundWindow = ensureBackgroundWindow();
    if (backgroundWindow.webContents.isLoadingMainFrame()) {
      backgroundWindow.webContents.once("did-finish-load", () => {
        if (!backgroundWindow.isDestroyed()) {
          backgroundWindow.webContents.send(ipcChannels.trayAction, { action });
        }
      });
      return;
    }

    backgroundWindow.webContents.send(ipcChannels.trayAction, { action });
  }

  function registerGlobalShortcuts() {
    globalShortcut.unregisterAll();
    const registered = globalShortcut.register(GLOBAL_MIC_SHORTCUT, () => {
      sendTrayAction("toggle-mic");
    });

    if (!registered) {
      console.error(`[flowos][shortcut] failed to register ${GLOBAL_MIC_SHORTCUT}`);
    }
  }

  function buildMenuBarMenu() {
    return Menu.buildFromTemplate([
      {
        label: trackingSession.getState().isTracking ? "Tracking Active" : "Start Tracking",
        enabled: !trackingSession.getState().isTracking,
        click: () => {
          startTracking();
        }
      },
      {
        label: flowModeStatus === "running" ? "Entering Flow State..." : "Enter Flow State",
        enabled: flowModeStatus !== "running",
        submenu: [
          {
            label: "Coding Mode",
            enabled: flowModeStatus !== "running",
            click: () => {
              void runEnterFlowMode("coding");
            }
          },
          {
            label: "Research Mode",
            enabled: flowModeStatus !== "running",
            click: () => {
              void runEnterFlowMode("research");
            }
          },
          {
            label: trackingSession.getState().isTracking
              ? "Auto (from tracking)"
              : "Auto (requires tracking)",
            enabled: flowModeStatus !== "running",
            click: () => {
              void runEnterFlowMode("auto");
            }
          }
        ]
      },
      {
        label: "Toggle Mic",
        click: () => {
          sendTrayAction("toggle-mic");
        }
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.quit();
        }
      }
    ]);
  }

  function togglePopover(trayBounds?: Electron.Rectangle) {
    const win = ensureBackgroundWindow();
    if (win.isVisible()) {
      win.hide();
      return;
    }
    if (trayBounds) {
      const [winWidthRaw] = win.getSize();
      const winWidth = winWidthRaw ?? 340;
      const { workAreaSize } = screen.getPrimaryDisplay();
      const x = Math.max(0, Math.min(
        Math.round(trayBounds.x + trayBounds.width / 2 - winWidth / 2),
        workAreaSize.width - winWidth
      ));
      const y = Math.round(trayBounds.y + trayBounds.height + 2);
      win.setPosition(x, y, false);
    }
    win.show();
    win.focus();
  }

  function refreshMenuBar() {
    if (process.platform !== "darwin") {
      return;
    }

    if (!menuBarTray) {
      menuBarTray = new Tray(nativeImage.createEmpty());
      menuBarTray.setTitle("FlowOS");
      menuBarTray.setToolTip("FlowOS");
      menuBarTray.on("click", (_event, bounds) => {
        togglePopover(bounds);
      });
      menuBarTray.on("right-click", () => {
        menuBarTray?.popUpContextMenu(
          Menu.buildFromTemplate([{ label: "Quit FlowOS", click: () => app.quit() }])
        );
      });
    }
  }

  refreshMenuBar();
  ensureBackgroundWindow();
  registerGlobalShortcuts();
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.setActivationPolicy("accessory");
  }
  void bootstrap();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && process.platform !== "darwin") {
    mainWindow = createMainWindow({ show: true });
  }
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  menuBarTray?.destroy();
  menuBarTray = null;
  realtimeServer?.stop();
  nativeHelperTelemetry?.stop();
  nativeHelperBridge?.stop();
  observationService?.stop();
  db?.close();
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

  let result: ChromeCommandResultMap[C];
  switch (command) {
    case "chrome.tab.focus":
      result = (await chromeEditor.focusTab(
        (payload as ChromeCommandPayloadMap["chrome.tab.focus"]).tabId
      )) as ChromeCommandResultMap[C];
      break;
    case "chrome.tabs.group":
      result = (await chromeEditor.groupTabs(
        payload as ChromeCommandPayloadMap["chrome.tabs.group"]
      )) as ChromeCommandResultMap[C];
      break;
    case "chrome.tabs.ungroup":
      result = (await chromeEditor.ungroupTabs(
        (payload as ChromeCommandPayloadMap["chrome.tabs.ungroup"]).tabIds
      )) as ChromeCommandResultMap[C];
      break;
    case "chrome.tab.pin":
      result = (await chromeEditor.pinTab(
        (payload as ChromeCommandPayloadMap["chrome.tab.pin"]).tabId,
        (payload as ChromeCommandPayloadMap["chrome.tab.pin"]).pinned
      )) as ChromeCommandResultMap[C];
      break;
    case "chrome.tabs.close":
      result = (await chromeEditor.closeTabs(
        (payload as ChromeCommandPayloadMap["chrome.tabs.close"]).tabIds
      )) as ChromeCommandResultMap[C];
      break;
    case "chrome.tab.open":
      result = (await chromeEditor.openTab(
        payload as ChromeCommandPayloadMap["chrome.tab.open"]
      )) as ChromeCommandResultMap[C];
      break;
    default:
      throw new Error(`Unsupported chrome command: ${String(command)}`);
  }

  return result;
}

function refreshTaskStateFromSignals() {
  const signals: TaskSignal[] = [];

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
}

function appendMemoryEntry(title: string, summary: string, data?: unknown) {
  if (!persistentMemoryStore) {
    return;
  }

  void persistentMemoryStore.appendEntry({ title, summary, data }).catch((error) => {
    console.error("[flowos][memory] failed to append entry", error);
  });
}
