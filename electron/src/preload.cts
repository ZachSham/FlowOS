import { contextBridge, ipcRenderer } from "electron";

const ipcChannels = {
  getBootstrapState: "bootstrap:get-state",
  startTracking: "tracking:start",
  enterFlowMode: "flow:enter"
} as const;

contextBridge.exposeInMainWorld("flowos", {
  getBootstrapState: () => ipcRenderer.invoke(ipcChannels.getBootstrapState),
  startTracking: () => ipcRenderer.invoke(ipcChannels.startTracking),
  enterFlowMode: () => ipcRenderer.invoke(ipcChannels.enterFlowMode)
});
