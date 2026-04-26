import type { NativeEventEnvelope, SystemSnapshot } from "@flowos/shared";

interface NativeHelperTelemetryBridge {
  onEvent(listener: (event: NativeEventEnvelope) => void): () => void;
  request(method: "system.snapshot", payload: Record<string, never>): Promise<SystemSnapshot>;
}

interface NativeHelperTelemetryHandle {
  stop(): void;
}

export async function startNativeHelperTelemetry(
  bridge: NativeHelperTelemetryBridge
): Promise<NativeHelperTelemetryHandle> {
  const unsubscribe = bridge.onEvent((event) => {
    logEvent("native", event.event, event.payload);
  });

  try {
    const snapshot = await bridge.request("system.snapshot", {});
    logEvent("native", "system.snapshot", snapshot);
  } catch (error) {
    logEvent("native", "system.snapshot.failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return {
    stop() {
      unsubscribe();
    }
  };
}

function logEvent(scope: string, label: string, payload: object) {
  const timestamp = new Date().toISOString();
  console.log(`[flowos][${scope}] ${timestamp} ${label}`);
  console.log(JSON.stringify(payload, null, 2));
}

