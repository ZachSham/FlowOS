import type {
  NativeActionResult,
  SystemSnapshot
} from "./native-snapshots.js";

export interface NativeRequestPayloadMap {
  "helper.ping": Record<string, never>;
  "system.snapshot": Record<string, never>;
  "app.activate": {
    bundleId: string;
  };
  "app.hide": {
    bundleId: string;
  };
  "app.unhide": {
    bundleId: string;
  };
  "window.raise": {
    windowId: string;
  };
  "window.minimize": {
    windowId: string;
  };
  "window.restore": {
    windowId: string;
  };
  "window.move": {
    windowId: string;
    x: number;
    y: number;
  };
  "window.resize": {
    windowId: string;
    width: number;
    height: number;
  };
  "window.setFrame": {
    windowId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface NativeResponsePayloadMap {
  "helper.ping": {
    name: string;
    version: string;
    transport: "stdio";
  };
  "system.snapshot": SystemSnapshot;
  "app.activate": NativeActionResult;
  "app.hide": NativeActionResult;
  "app.unhide": NativeActionResult;
  "window.raise": NativeActionResult;
  "window.minimize": NativeActionResult;
  "window.restore": NativeActionResult;
  "window.move": NativeActionResult;
  "window.resize": NativeActionResult;
  "window.setFrame": NativeActionResult;
}

export type NativeMethod = keyof NativeRequestPayloadMap;
