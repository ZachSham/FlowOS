export const ipcChannels = {
  getBootstrapState: "bootstrap:get-state",
  startTracking: "tracking:start",
  enterFlowMode: "flow:enter",
  stateUpdated: "state:updated",
  runChromeCommand: "chrome:run-command"
} as const;
