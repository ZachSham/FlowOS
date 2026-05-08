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
  stopTracking: "tracking:stop",
  enterFlowMode: "flow:enter",
  stateUpdated: "state:updated",
  trayAction: "tray:action",
  runChromeCommand: "chrome:run-command",
  runVoiceCommand: "voice:run-command",
  transcribeAudio: "voice:transcribe",
  showWindow: "window:show",
  hideWindow: "window:hide",
  saveLayout: "layout:save",
  listLayouts: "layout:list",
  deleteLayout: "layout:delete",
  recallLayout: "layout:recall",
  analyticsWeekly: "analytics:weekly",
  licenseGet: "license:get",
  licenseActivate: "license:activate",
  licenseDeactivate: "license:deactivate",
  triggerSuggestion: "trigger:suggestion",
  capsuleSave: "capsule:save",
  capsuleList: "capsule:list",
  capsuleRestore: "capsule:restore",
  capsuleDelete: "capsule:delete",
  focusScore: "focus:score",
  focusAlert: "focus:alert"
} as const;

try {
  contextBridge.exposeInMainWorld("flowos", {
    getBootstrapState: () => ipcRenderer.invoke(channels.getBootstrapState),
    startTracking: () => ipcRenderer.invoke(channels.startTracking),
    stopTracking: () => ipcRenderer.invoke(channels.stopTracking),
    enterFlowMode: (mode: "coding" | "research" | "auto") =>
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
    hideWindow: () => ipcRenderer.invoke(channels.hideWindow),
    listLayouts: () => ipcRenderer.invoke(channels.listLayouts),
    saveLayout: (payload: { name: string; mode: string; windows: unknown[] }) =>
      ipcRenderer.invoke(channels.saveLayout, payload),
    deleteLayout: (id: string) => ipcRenderer.invoke(channels.deleteLayout, id),
    recallLayout: (id: string) => ipcRenderer.invoke(channels.recallLayout, id),
    analyticsWeekly: () => ipcRenderer.invoke(channels.analyticsWeekly),
    licenseGet: () => ipcRenderer.invoke(channels.licenseGet),
    licenseActivate: (key: string) => ipcRenderer.invoke(channels.licenseActivate, key),
    licenseDeactivate: () => ipcRenderer.invoke(channels.licenseDeactivate),
    onTriggerSuggestion: (callback: (suggestion: unknown) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, suggestion: unknown) => callback(suggestion);
      ipcRenderer.on(channels.triggerSuggestion, wrapped);
      return () => { ipcRenderer.removeListener(channels.triggerSuggestion, wrapped); };
    },
    capsuleList: () => ipcRenderer.invoke(channels.capsuleList),
    capsuleSave: (name: string) => ipcRenderer.invoke(channels.capsuleSave, name),
    capsuleRestore: (id: string) => ipcRenderer.invoke(channels.capsuleRestore, id),
    capsuleDelete: (id: string) => ipcRenderer.invoke(channels.capsuleDelete, id),
    onFocusScore: (callback: (update: { score: number }) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, update: { score: number }) => callback(update);
      ipcRenderer.on(channels.focusScore, wrapped);
      return () => { ipcRenderer.removeListener(channels.focusScore, wrapped); };
    },
    onFocusAlert: (callback: () => void) => {
      const wrapped = () => callback();
      ipcRenderer.on(channels.focusAlert, wrapped);
      return () => { ipcRenderer.removeListener(channels.focusAlert, wrapped); };
    }
  });
} catch (error) {
  console.error("[flowos][preload] failed to expose bridge", error);
}
