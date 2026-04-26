import type { NativeEventEnvelope } from "@flowos/shared";

export interface TrackingEventRecord {
  timestamp: string;
  event: string;
  summary: string;
  payload: object;
}

export interface TrackingState {
  isTracking: boolean;
  startedAt: string | null;
  eventCount: number;
  recentEvents: TrackingEventRecord[];
}

export class TrackingSession {
  private readonly recentEvents: TrackingEventRecord[] = [];
  private isTracking = false;
  private startedAt: string | null = null;
  private eventCount = 0;

  start() {
    if (!this.isTracking) {
      this.isTracking = true;
      this.startedAt = new Date().toISOString();
      this.eventCount = 0;
      this.recentEvents.length = 0;
    }

    return this.getState();
  }

  getState(): TrackingState {
    return {
      isTracking: this.isTracking,
      startedAt: this.startedAt,
      eventCount: this.eventCount,
      recentEvents: [...this.recentEvents]
    };
  }

  getSummary() {
    const countsByEvent = this.recentEvents.reduce<Record<string, number>>((counts, event) => {
      counts[event.event] = (counts[event.event] ?? 0) + 1;
      return counts;
    }, {});

    return {
      ...this.getState(),
      countsByEvent
    };
  }

  record(event: NativeEventEnvelope) {
    if (!this.isTracking) {
      return;
    }

    const timestamp = extractTimestamp(event.payload);
    this.eventCount += 1;
    this.recentEvents.unshift({
      timestamp,
      event: event.event,
      summary: summarizeEvent(event),
      payload: event.payload
    });

    if (this.recentEvents.length > 50) {
      this.recentEvents.length = 50;
    }
  }
}

function extractTimestamp(payload: object) {
  const candidate = (payload as { timestamp?: unknown }).timestamp;
  return typeof candidate === "string" ? candidate : new Date().toISOString();
}

function summarizeEvent(event: NativeEventEnvelope) {
  const payload = event.payload as {
    app?: { name?: string };
    display?: { label?: string };
  };

  switch (event.event) {
    case "app.activated":
    case "app.deactivated":
    case "app.launched":
    case "app.terminated":
      return payload.app?.name ? `${event.event} ${payload.app.name}` : event.event;
    case "display.changed":
      return payload.display?.label ? `${event.event} ${payload.display.label}` : event.event;
    default:
      return event.event;
  }
}
