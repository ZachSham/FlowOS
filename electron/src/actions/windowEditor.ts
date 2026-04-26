import type { NativeActionResult } from "@flowos/shared";
import type { NativeHelperBridge } from "../bridge/swiftHelper.js";

type NativeRequestExecutor = NativeHelperBridge["request"];

export class WindowEditor {
  constructor(private readonly request: NativeRequestExecutor) {}

  setFrame(
    windowId: string,
    frame: { x: number; y: number; width: number; height: number }
  ): Promise<NativeActionResult> {
    return this.request("window.setFrame", {
      windowId,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height
    });
  }

  move(windowId: string, position: { x: number; y: number }): Promise<NativeActionResult> {
    return this.request("window.move", {
      windowId,
      x: position.x,
      y: position.y
    });
  }

  resize(
    windowId: string,
    size: { width: number; height: number }
  ): Promise<NativeActionResult> {
    return this.request("window.resize", {
      windowId,
      width: size.width,
      height: size.height
    });
  }

  raise(windowId: string): Promise<NativeActionResult> {
    return this.request("window.raise", { windowId });
  }

  minimize(windowId: string): Promise<NativeActionResult> {
    return this.request("window.minimize", { windowId });
  }

  restore(windowId: string): Promise<NativeActionResult> {
    return this.request("window.restore", { windowId });
  }

  clearFullscreenAtLocation(frame: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<NativeActionResult> {
    return this.request("window.clearFullscreenAtLocation", frame);
  }

  activateApp(bundleId: string): Promise<NativeActionResult> {
    return this.request("app.activate", { bundleId });
  }

  hideApp(bundleId: string): Promise<NativeActionResult> {
    return this.request("app.hide", { bundleId });
  }

  unhideApp(bundleId: string): Promise<NativeActionResult> {
    return this.request("app.unhide", { bundleId });
  }
}

export function createWindowEditor(bridge: Pick<NativeHelperBridge, "request">) {
  return new WindowEditor(bridge.request.bind(bridge) as NativeRequestExecutor);
}
