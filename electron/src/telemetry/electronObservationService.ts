import { app, screen, systemPreferences } from "electron";

type SubscriptionCleanup = () => void;

interface ObservationService {
  stop(): void;
}

export async function startElectronObservationService(): Promise<ObservationService> {
  const cleanups: SubscriptionCleanup[] = [];

  logEvent("helper", "electron observation service started", {
    platform: process.platform,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node
  });

  logEvent("permissions", "current permission status", {
    accessibilityTrusted: systemPreferences.isTrustedAccessibilityClient(false),
    screenRecordingStatus:
      process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "unsupported"
  });

  logDisplays("initial displays");

  screen.on("display-added", (_event, newDisplay) => {
    logEvent("display", "display added", simplifyDisplay(newDisplay));
  });
  screen.on("display-removed", (_event, oldDisplay) => {
    logEvent("display", "display removed", simplifyDisplay(oldDisplay));
  });
  screen.on("display-metrics-changed", (_event, updatedDisplay, changedMetrics) => {
    if (changedMetrics.length === 0) {
      return;
    }

    logEvent("display", "display metrics changed", {
      changedMetrics,
      display: simplifyDisplay(updatedDisplay)
    });
  });

  cleanups.push(() => {
    screen.removeAllListeners("display-added");
    screen.removeAllListeners("display-removed");
    screen.removeAllListeners("display-metrics-changed");
  });

  app.on("browser-window-focus", (_event, browserWindow) => {
    logEvent("flowos-window", "browser window focused", {
      title: browserWindow.getTitle(),
      bounds: browserWindow.getBounds()
    });
  });

  cleanups.push(() => {
    app.removeAllListeners("browser-window-focus");
  });

  return {
    stop() {
      for (const cleanup of cleanups.reverse()) {
        cleanup();
      }
      logEvent("helper", "electron observation service stopped", {});
    }
  };
}

function logDisplays(label: string) {
  const displays = screen.getAllDisplays().map(simplifyDisplay);
  logEvent("display", label, { displays });
}

function simplifyDisplay(display: Electron.Display) {
  return {
    id: display.id,
    label: display.label,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: display.internal
  };
}

function logEvent(scope: string, label: string, payload: object) {
  const timestamp = new Date().toISOString();
  console.log(`[flowos][${scope}] ${timestamp} ${label}`);
  console.log(JSON.stringify(payload, null, 2));
}
