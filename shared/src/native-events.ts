import type { AppSnapshot, DisplaySnapshot, WindowSnapshot } from "./native-snapshots.js";

export interface HelperReadyEvent {
  timestamp: string;
  name: string;
  version: string;
  transport: "stdio";
}

export interface AppLifecycleEvent {
  timestamp: string;
  app: AppSnapshot;
}

export interface SpaceChangedEvent {
  timestamp: string;
}

export interface DisplayChangedEvent {
  timestamp: string;
  change: "added" | "removed" | "metrics";
  display: DisplaySnapshot;
  changedMetrics?: string[];
}

export interface FocusedWindowEvent {
  timestamp: string;
  window: WindowSnapshot | null;
}

export interface NativeEventPayloadMap {
  "helper.ready": HelperReadyEvent;
  "app.activated": AppLifecycleEvent;
  "app.deactivated": AppLifecycleEvent;
  "app.launched": AppLifecycleEvent;
  "app.terminated": AppLifecycleEvent;
  "space.changed": SpaceChangedEvent;
  "display.changed": DisplayChangedEvent;
  "window.focused": FocusedWindowEvent;
}

export type NativeEventName = keyof NativeEventPayloadMap;

