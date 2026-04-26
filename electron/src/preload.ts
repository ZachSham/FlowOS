import { contextBridge, ipcRenderer } from "electron";
import type { VoiceCommandResult } from "@flowos/shared";
import { ipcChannels } from "./ipc/channels.js";

contextBridge.exposeInMainWorld("flowos", {
  getBootstrapState: () => ipcRenderer.invoke(ipcChannels.getBootstrapState),
  runVoiceCommand: (transcript: string): Promise<VoiceCommandResult> =>
    ipcRenderer.invoke(ipcChannels.runVoiceCommand, transcript)
});
