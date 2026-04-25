import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels } from "./ipc/channels.js";
import type { TaskState, Suggestion } from "@flowos/shared";

interface LiveState {
  taskState?: TaskState;
  suggestions?: Suggestion[];
  reasoning?: string;
  hasError: boolean;
}

contextBridge.exposeInMainWorld("flowos", {
  getBootstrapState: () => ipcRenderer.invoke(ipcChannels.getBootstrapState),

  onStateUpdate: (callback: (state: LiveState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: LiveState) =>
      callback(state);
    ipcRenderer.on(ipcChannels.stateUpdated, handler);
    return () => ipcRenderer.removeListener(ipcChannels.stateUpdated, handler);
  },

  onStateLoading: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(ipcChannels.stateLoading, handler);
    return () => ipcRenderer.removeListener(ipcChannels.stateLoading, handler);
  },
});
