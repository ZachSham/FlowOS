export const ipcChannels = {
  getBootstrapState: "bootstrap:get-state",
  startTracking: "tracking:start",
  enterFlowMode: "flow:enter",
  stateUpdated: "state:updated",
  trayAction: "tray:action",
  runChromeCommand: "chrome:run-command",
  runVoiceCommand: "voice:run-command",
  transcribeAudio: "voice:transcribe"
} as const;
