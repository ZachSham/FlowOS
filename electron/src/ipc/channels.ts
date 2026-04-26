export const ipcChannels = {
  getBootstrapState: "bootstrap:get-state",
  stateUpdated: "state:updated",
  runChromeCommand: "chrome:run-command"
} as const;
