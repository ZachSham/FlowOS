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
  runChromeCommand: "chrome:run-command"
} as const;

try {
  contextBridge.exposeInMainWorld("flowos", {
    getBootstrapState: () => ipcRenderer.invoke(channels.getBootstrapState),
    startTracking: () => ipcRenderer.invoke(channels.startTracking),
    enterFlowMode: () => ipcRenderer.invoke(channels.enterFlowMode),
    onStateUpdated: (listener: (state: StateUpdatePayload) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: StateUpdatePayload) => {
        listener(payload);
      };
      ipcRenderer.on(channels.stateUpdated, wrapped);
      return () => {
        ipcRenderer.removeListener(channels.stateUpdated, wrapped);
      };
    },
    runChromeCommand: <C extends ChromeCommand>(command: C, payload: ChromeCommandPayloadMap[C]) =>
      ipcRenderer.invoke(channels.runChromeCommand, { command, payload }) as Promise<
        ChromeCommandResultMap[C]
      >
  });
} catch (error) {
  console.error("[flowos][preload] failed to expose bridge", error);
}
