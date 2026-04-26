import type {
  NativeAction,
  NativeWindowFrame,
  NativeWindowPosition,
  NativeWindowSize
} from "@flowos/shared";
import { executeSwiftNativeAction, type SwiftNativeActionResult } from "../bridge/swiftHelper.js";

export type NativeActionExecutor = (action: NativeAction) => Promise<SwiftNativeActionResult>;

export class WindowEditor {
  constructor(private readonly execute: NativeActionExecutor = executeSwiftNativeAction) {}

  setFrame(windowId: string, frame: NativeWindowFrame): Promise<SwiftNativeActionResult> {
    return this.execute({
      type: "native.window.setFrame",
      windowId,
      frame
    });
  }

  move(windowId: string, position: NativeWindowPosition): Promise<SwiftNativeActionResult> {
    return this.execute({
      type: "native.window.move",
      windowId,
      position
    });
  }

  resize(windowId: string, size: NativeWindowSize): Promise<SwiftNativeActionResult> {
    return this.execute({
      type: "native.window.resize",
      windowId,
      size
    });
  }

  raise(windowId: string): Promise<SwiftNativeActionResult> {
    return this.execute({
      type: "native.window.raise",
      windowId
    });
  }

  activateApp(bundleId: string): Promise<SwiftNativeActionResult> {
    return this.execute({
      type: "native.app.activate",
      bundleId
    });
  }
}
