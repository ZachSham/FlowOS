import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels } from "./ipc/channels.js";
import type { TaskState, Suggestion } from "@flowos/shared";

export interface LiveState {
  taskState?: TaskState;
  suggestions?: Suggestion[];
  reasoning?: string;
  hasError: boolean;
}

contextBridge.exposeInMainWorld("flowos", {
  getBootstrapState: () => ipcRenderer.invoke(ipcChannels.getBootstrapState),

  onStateUpdate: (callback: (state: LiveState) => void) => {
    ipcRenderer.on(ipcChannels.stateUpdated, (_event, state: LiveState) =>
      callback(state)
    );
  },

  onStateLoading: (callback: () => void) => {
    ipcRenderer.on(ipcChannels.stateLoading, () => callback());
  },
});
