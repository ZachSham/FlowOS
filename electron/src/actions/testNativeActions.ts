import type { NativeAction } from "@flowos/shared";
import { executeMockNativeAction } from "./nativeActions.js";

const actions: unknown[] = [
  {
    type: "native.window.setFrame",
    windowId: "w_editor",
    frame: { x: 0, y: 25, width: 950, height: 980 }
  } satisfies NativeAction,
  {
    type: "native.window.move",
    windowId: "w_editor",
    position: { x: 0, y: 25 }
  } satisfies NativeAction,
  {
    type: "native.window.resize",
    windowId: "w_editor",
    size: { width: 950, height: 980 }
  } satisfies NativeAction,
  {
    type: "native.window.raise",
    windowId: "w_editor"
  } satisfies NativeAction,
  {
    type: "native.app.activate",
    bundleId: "com.microsoft.VSCode"
  } satisfies NativeAction,
  {
    type: "native.window.resize",
    windowId: "w_editor",
    size: { width: 950, height: 0 }
  }
];

for (const action of actions) {
  const result = await executeMockNativeAction(action);
  console.log("[mock-native] result", result);
}
