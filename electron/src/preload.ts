import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels } from "./ipc/channels.js";

contextBridge.exposeInMainWorld("flowos", {
  getBootstrapState: () => ipcRenderer.invoke(ipcChannels.getBootstrapState)
});

