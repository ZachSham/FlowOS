import { contextBridge, ipcRenderer } from "electron";
import type {
  ChromeCommand,
  ChromeCommandPayloadMap,
  ChromeCommandResultMap,
  Suggestion,
  TaskState
} from "@flowos/shared";

type StateUpdatePayload = {
  taskState: TaskState;
  suggestions: Suggestion[];
};

const channels = {
  getBootstrapState: "bootstrap:get-state",
  startTracking: "tracking:start",
  enterFlowMode: "flow:enter",
  stateUpdated: "state:updated",
  trayAction: "tray:action",
  runChromeCommand: "chrome:run-command",
  runVoiceCommand: "voice:run-command",
  transcribeAudio: "voice:transcribe",
  showWindow: "window:show",
  hideWindow: "window:hide"
} as const;

try {
  contextBridge.exposeInMainWorld("flowos", {
    getBootstrapState: () => ipcRenderer.invoke(channels.getBootstrapState),
    startTracking: () => ipcRenderer.invoke(channels.startTracking),
    enterFlowMode: (mode: "coding" | "research") =>
      ipcRenderer.invoke(channels.enterFlowMode, { mode }),
    onStateUpdated: (listener: (state: StateUpdatePayload) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: StateUpdatePayload) => {
        listener(payload);
      };
      ipcRenderer.on(channels.stateUpdated, wrapped);
      return () => {
        ipcRenderer.removeListener(channels.stateUpdated, wrapped);
      };
    },
    onTrayAction: (listener: (action: "toggle-mic") => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: { action: "toggle-mic" }) => {
        listener(payload.action);
      };
      ipcRenderer.on(channels.trayAction, wrapped);
      return () => {
        ipcRenderer.removeListener(channels.trayAction, wrapped);
      };
    },
    runChromeCommand: <C extends ChromeCommand>(command: C, payload: ChromeCommandPayloadMap[C]) =>
      ipcRenderer.invoke(channels.runChromeCommand, { command, payload }) as Promise<
        ChromeCommandResultMap[C]
      >,
    runVoiceCommand: (transcript: string) =>
      ipcRenderer.invoke(channels.runVoiceCommand, transcript),
    transcribeAudio: (audioData: Uint8Array) =>
      ipcRenderer.invoke(channels.transcribeAudio, audioData) as Promise<string>,
    showWindow: () => ipcRenderer.invoke(channels.showWindow),
    hideWindow: () => ipcRenderer.invoke(channels.hideWindow)
  });
} catch (error) {
  console.error("[flowos][preload] failed to expose bridge", error);
}
