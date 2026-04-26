import { getRealSwiftHelperStatus, listSwiftWindows } from "../bridge/swiftHelper.js";
import { WindowEditor } from "./windowEditor.js";

const targetWindowId = process.env.FLOWOS_TEST_WINDOW_ID;
const editor = new WindowEditor();

const status = await getRealSwiftHelperStatus();
console.log("[swift-helper] status", status);

if (!status.accessibilityReady) {
  console.log("[swift-helper] Accessibility is not ready. Run:");
  console.log("  swift-helper/.build/debug/FlowStateHelper request-accessibility");
  process.exit(0);
}

const windows = await listSwiftWindows();
console.log("[swift-helper] windows", windows.slice(0, 10));

if (!targetWindowId) {
  console.log("[window-editor] Set FLOWOS_TEST_WINDOW_ID to one of the listed windowId values to move/resize it.");
  process.exit(0);
}

const target = windows.find((window) => window.windowId === targetWindowId);

if (!target?.frame) {
  console.log("[window-editor] Target window not found or has no frame", targetWindowId);
  process.exit(1);
}

const originalFrame = target.frame;
const adjustedFrame = {
  x: originalFrame.x + 30,
  y: originalFrame.y + 30,
  width: Math.max(300, originalFrame.width - 80),
  height: Math.max(240, originalFrame.height - 80)
};

console.log("[window-editor] raise", await editor.raise(targetWindowId));
console.log("[window-editor] setFrame", await editor.setFrame(targetWindowId, adjustedFrame));
console.log("[window-editor] restore", await editor.setFrame(targetWindowId, originalFrame));
