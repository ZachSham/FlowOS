import { app, screen, systemPreferences } from "electron";
import type { DisplaySnapshot } from "@flowos/shared";
import type { TrackingSession } from "../services/trackingSession.js";

type SubscriptionCleanup = () => void;

interface ObservationService {
  stop(): void;
}

interface ObservationServiceOptions {
  trackingSession?: TrackingSession;
}

export async function startElectronObservationService(
  options: ObservationServiceOptions = {}
): Promise<ObservationService> {
  const cleanups: SubscriptionCleanup[] = [];
  const { trackingSession } = options;

  function recordDisplay(
    change: "added" | "removed" | "metrics",
    display: Electron.Display,
    changedMetrics?: string[]
  ) {
    if (!trackingSession) {
      return;
    }
    trackingSession.record({
      kind: "event",
      event: "display.changed",
      payload: {
        timestamp: new Date().toISOString(),
        change,
        display: toDisplaySnapshot(display),
        ...(changedMetrics ? { changedMetrics } : {})
      }
    });
  }

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
    recordDisplay("added", newDisplay);
  });
  screen.on("display-removed", (_event, oldDisplay) => {
    logEvent("display", "display removed", simplifyDisplay(oldDisplay));
    recordDisplay("removed", oldDisplay);
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

function toDisplaySnapshot(display: Electron.Display): DisplaySnapshot {
  const primaryId = screen.getPrimaryDisplay().id;
  return {
    id: String(display.id),
    label: display.label,
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    visibleX: display.workArea.x,
    visibleY: display.workArea.y,
    visibleWidth: display.workArea.width,
    visibleHeight: display.workArea.height,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: display.internal,
    isPrimary: display.id === primaryId
  };
}

function logEvent(scope: string, label: string, payload: object) {
  const timestamp = new Date().toISOString();
  console.log(`[flowos][${scope}] ${timestamp} ${label}`);
  console.log(JSON.stringify(payload, null, 2));
}
