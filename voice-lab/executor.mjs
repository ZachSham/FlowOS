import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseVoiceTranscriptWithFallback } from "./llm-parser.mjs";
import { getNativeHelperClient, stopNativeHelperClient } from "./helper-client.mjs";

const execFileAsync = promisify(execFile);

function parseNativeRequestCommand(commandString) {
  const match = commandString.match(/^NATIVE_REQUEST\s+method=([^\s]+)\s+payload=(.+)$/);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  try {
    const payload = JSON.parse(match[2]);
    return {
      method: match[1],
      payload
    };
  } catch {
    return null;
  }
}

function parseFlowCommand(commandString) {
  const tokens = commandString.trim().split(/\s+/);
  if (tokens[0] !== "FLOW_COMMAND") {
    return null;
  }

  const values = {};
  for (const token of tokens.slice(1)) {
    const index = token.indexOf("=");
    if (index < 0) {
      continue;
    }

    const key = token.slice(0, index);
    const value = token.slice(index + 1);
    values[key] = value;
  }

  return values;
}

function isInternalWindow(windowSnapshot) {
  const appName = String(windowSnapshot?.appName ?? "").toLowerCase();
  const bundleId = String(windowSnapshot?.bundleId ?? "").toLowerCase();

  return (
    appName.includes("flowos") ||
    appName.includes("codex") ||
    bundleId.includes("flowos") ||
    bundleId === "com.openai.codex"
  );
}

function hasFrame(windowSnapshot) {
  return (
    Number.isFinite(windowSnapshot?.x) &&
    Number.isFinite(windowSnapshot?.y) &&
    Number.isFinite(windowSnapshot?.width) &&
    Number.isFinite(windowSnapshot?.height)
  );
}

function pickWindowForBundle(windows, bundleId) {
  return windows.find((windowSnapshot) => hasFrame(windowSnapshot) && windowSnapshot.bundleId === bundleId);
}

async function requestNative(method, payload = {}) {
  const client = getNativeHelperClient();
  return client.request(method, payload);
}

async function getSystemSnapshot() {
  return requestNative("system.snapshot", {});
}

async function resolveTargetWindow(target) {
  const snapshot = await getSystemSnapshot();
  const windows = Array.isArray(snapshot.windows) ? snapshot.windows : [];
  const candidates = windows.filter((windowSnapshot) => hasFrame(windowSnapshot) && !windowSnapshot.isMinimized);

  if (candidates.length === 0) {
    return {
      ok: false,
      message: "No movable windows found."
    };
  }

  if (target?.startsWith("app:")) {
    const bundleId = target.slice(4);
    const appWindow = pickWindowForBundle(candidates, bundleId);

    if (!appWindow) {
      return {
        ok: false,
        message: `No visible window found for app target ${bundleId}.`
      };
    }

    return {
      ok: true,
      window: appWindow,
      snapshot
    };
  }

  if (snapshot.focusedWindow && !snapshot.focusedWindow.isMinimized && !isInternalWindow(snapshot.focusedWindow)) {
    return {
      ok: true,
      window: snapshot.focusedWindow,
      snapshot
    };
  }

  const nonInternalWindow = candidates.find((windowSnapshot) => !isInternalWindow(windowSnapshot));
  return {
    ok: true,
    window: nonInternalWindow ?? candidates[0],
    snapshot
  };
}

function parseAmountToDelta(amount) {
  if (amount === "small") {
    return 80;
  }

  if (amount === "large") {
    return 320;
  }

  return 180;
}

function normalizeDisplayFrame(display) {
  return {
    x: Number(display.visibleX ?? display.x ?? 0),
    y: Number(display.visibleY ?? display.y ?? 0),
    width: Number(display.visibleWidth ?? display.width ?? 0),
    height: Number(display.visibleHeight ?? display.height ?? 0)
  };
}

function sortDisplays(displays) {
  return [...displays].sort((a, b) => {
    if (a.x !== b.x) {
      return a.x - b.x;
    }

    return a.y - b.y;
  });
}

function containsPoint(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function overlapArea(a, b) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  if (right <= left || bottom <= top) {
    return 0;
  }

  return (right - left) * (bottom - top);
}

function locateCurrentDisplay(frame, displays) {
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;

  const byCenter = displays.findIndex((display) => containsPoint(display, centerX, centerY));
  if (byCenter >= 0) {
    return byCenter;
  }

  let bestIndex = 0;
  let bestOverlap = -1;

  for (const [index, display] of displays.entries()) {
    const overlap = overlapArea(frame, display);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeFrameOnNextDisplay(frame, displays) {
  const sorted = sortDisplays(displays);
  const currentIndex = locateCurrentDisplay(frame, sorted);
  const currentDisplay = sorted[currentIndex] ?? sorted[0];

  if (!currentDisplay) {
    return frame;
  }

  const targetDisplay = sorted[(currentIndex + 1) % sorted.length] ?? currentDisplay;
  const width = Math.min(frame.width, targetDisplay.width);
  const height = Math.min(frame.height, targetDisplay.height);

  const sourceCenterXRatio = clamp(
    (frame.x + frame.width / 2 - currentDisplay.x) / Math.max(currentDisplay.width, 1),
    0,
    1
  );
  const sourceCenterYRatio = clamp(
    (frame.y + frame.height / 2 - currentDisplay.y) / Math.max(currentDisplay.height, 1),
    0,
    1
  );

  const targetCenterX = targetDisplay.x + targetDisplay.width * sourceCenterXRatio;
  const targetCenterY = targetDisplay.y + targetDisplay.height * sourceCenterYRatio;

  const x = clamp(targetCenterX - width / 2, targetDisplay.x, targetDisplay.x + targetDisplay.width - width);
  const y = clamp(targetCenterY - height / 2, targetDisplay.y, targetDisplay.y + targetDisplay.height - height);

  return {
    x,
    y,
    width,
    height
  };
}

async function executeMoveRelative(flowCommand) {
  const target = flowCommand.target ?? "frontmost";
  const direction = flowCommand.direction ?? "right";
  const amount = flowCommand.amount ?? "medium";

  const targetWindowResult = await resolveTargetWindow(target);
  if (!targetWindowResult.ok || !targetWindowResult.window) {
    return {
      ok: false,
      message: targetWindowResult.message ?? "Unable to resolve target window.",
      details: targetWindowResult
    };
  }

  const windowSnapshot = targetWindowResult.window;
  const delta = parseAmountToDelta(amount);

  let x = windowSnapshot.x;
  let y = windowSnapshot.y;

  if (direction === "left") {
    x -= delta;
  } else if (direction === "right") {
    x += delta;
  } else if (direction === "up") {
    y -= delta;
  } else if (direction === "down") {
    y += delta;
  }

  const nativeResult = await requestNative("window.move", {
    windowId: windowSnapshot.windowId,
    x,
    y
  });

  return {
    ok: true,
    message: "Window move command executed.",
    targetWindow: windowSnapshot,
    nativeResult
  };
}

async function executeMoveToOtherDisplay(flowCommand) {
  const target = flowCommand.target ?? "frontmost";
  const targetWindowResult = await resolveTargetWindow(target);

  if (!targetWindowResult.ok || !targetWindowResult.window || !targetWindowResult.snapshot) {
    return {
      ok: false,
      message: targetWindowResult.message ?? "Unable to resolve target window for other-display move.",
      details: targetWindowResult
    };
  }

  const displays = (targetWindowResult.snapshot.displays ?? []).map(normalizeDisplayFrame);
  if (displays.length < 2) {
    return {
      ok: false,
      message: "At least two displays are required."
    };
  }

  const frame = {
    x: targetWindowResult.window.x,
    y: targetWindowResult.window.y,
    width: targetWindowResult.window.width,
    height: targetWindowResult.window.height
  };

  const nextFrame = computeFrameOnNextDisplay(frame, displays);
  const nativeResult = await requestNative("window.setFrame", {
    windowId: targetWindowResult.window.windowId,
    x: nextFrame.x,
    y: nextFrame.y,
    width: nextFrame.width,
    height: nextFrame.height
  });

  return {
    ok: true,
    message: "Move-to-other-display command executed.",
    targetWindow: targetWindowResult.window,
    targetFrame: nextFrame,
    nativeResult
  };
}

async function executeMinimize(flowCommand) {
  const target = flowCommand.target ?? "frontmost";
  const targetWindowResult = await resolveTargetWindow(target);

  if (!targetWindowResult.ok || !targetWindowResult.window) {
    return {
      ok: false,
      message: targetWindowResult.message ?? "Unable to resolve target window for minimize.",
      details: targetWindowResult
    };
  }

  const nativeResult = await requestNative("window.minimize", {
    windowId: targetWindowResult.window.windowId
  });

  return {
    ok: true,
    message: "Window minimized.",
    targetWindow: targetWindowResult.window,
    nativeResult
  };
}

async function executeRaise(flowCommand) {
  const target = flowCommand.target ?? "frontmost";
  const targetWindowResult = await resolveTargetWindow(target);

  if (!targetWindowResult.ok || !targetWindowResult.window) {
    return {
      ok: false,
      message: targetWindowResult.message ?? "Unable to resolve target window for raise.",
      details: targetWindowResult
    };
  }

  const nativeResult = await requestNative("window.raise", {
    windowId: targetWindowResult.window.windowId
  });

  return {
    ok: true,
    message: "Window raised.",
    targetWindow: targetWindowResult.window,
    nativeResult
  };
}

async function executeRestore(flowCommand) {
  const target = flowCommand.target ?? "frontmost";
  const targetWindowResult = await resolveTargetWindow(target);

  if (!targetWindowResult.ok || !targetWindowResult.window) {
    return {
      ok: false,
      message: targetWindowResult.message ?? "Unable to resolve target window for restore.",
      details: targetWindowResult
    };
  }

  const nativeResult = await requestNative("window.restore", {
    windowId: targetWindowResult.window.windowId
  });

  return {
    ok: true,
    message: "Window restored.",
    targetWindow: targetWindowResult.window,
    nativeResult
  };
}

async function executeHideApp(flowCommand) {
  const target = flowCommand.target ?? "frontmost";
  const snapshot = await getSystemSnapshot();

  let bundleId = "";
  if (target.startsWith("app:")) {
    bundleId = target.slice(4);
  } else if (target === "frontmost") {
    bundleId = snapshot.frontmostApp?.bundleId ?? "";
  }

  if (!bundleId) {
    return {
      ok: false,
      message: "Could not resolve app target for hide command."
    };
  }

  const nativeResult = await requestNative("app.hide", {
    bundleId
  });

  return {
    ok: true,
    message: "App hidden.",
    bundleId,
    nativeResult
  };
}

async function executeFlowCommand(commandString) {
  const flowCommand = parseFlowCommand(commandString);
  if (!flowCommand?.type) {
    return {
      ok: false,
      message: "Invalid FLOW_COMMAND format."
    };
  }

  if (flowCommand.type === "helper.status") {
    const ping = await requestNative("helper.ping", {});
    const snapshot = await getSystemSnapshot();

    return {
      ok: true,
      message: "Helper status fetched.",
      ping,
      permissions: snapshot.permissions
    };
  }

  if (flowCommand.type === "system.list_windows") {
    const snapshot = await getSystemSnapshot();
    return {
      ok: true,
      message: "Window list fetched.",
      windows: snapshot.windows
    };
  }

  if (flowCommand.type === "system.list_screens") {
    const snapshot = await getSystemSnapshot();
    return {
      ok: true,
      message: "Display list fetched.",
      displays: snapshot.displays
    };
  }

  if (flowCommand.type === "permissions.open_accessibility_settings") {
    await execFileAsync("open", [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    ]);

    return {
      ok: true,
      message: "Opened Accessibility settings."
    };
  }

  if (flowCommand.type === "window.move_relative") {
    return executeMoveRelative(flowCommand);
  }

  if (flowCommand.type === "window.move_to_other_screen") {
    return executeMoveToOtherDisplay(flowCommand);
  }

  if (flowCommand.type === "window.minimize") {
    return executeMinimize(flowCommand);
  }

  if (flowCommand.type === "window.raise") {
    return executeRaise(flowCommand);
  }

  if (flowCommand.type === "window.restore") {
    return executeRestore(flowCommand);
  }

  if (flowCommand.type === "app.hide") {
    return executeHideApp(flowCommand);
  }

  return {
    ok: false,
    message: `Unsupported flow command type: ${flowCommand.type}`
  };
}

async function executeNativeRequestCommand(commandString) {
  const parsed = parseNativeRequestCommand(commandString);
  if (!parsed) {
    return {
      ok: false,
      message: "Invalid NATIVE_REQUEST command format."
    };
  }

  const nativeResult = await requestNative(parsed.method, parsed.payload);
  return {
    ok: true,
    message: `Executed ${parsed.method}.`,
    nativeResult
  };
}

export async function executeTranscript(transcript) {
  const parsed = await parseVoiceTranscriptWithFallback(transcript);

  if (!parsed.ok || !parsed.commandString) {
    return {
      ok: false,
      parsed,
      message: parsed.message
    };
  }

  try {
    const execution = parsed.commandString.startsWith("FLOW_COMMAND")
      ? await executeFlowCommand(parsed.commandString)
      : await executeNativeRequestCommand(parsed.commandString);

    return {
      ok: Boolean(execution.ok),
      parsed,
      execution,
      message: execution.ok ? "Command executed." : execution.message ?? "Execution failed."
    };
  } catch (error) {
    return {
      ok: false,
      parsed,
      message: error instanceof Error ? error.message : "Execution failed",
      execution: {
        ok: false,
        message: error instanceof Error ? error.message : "Execution failed"
      }
    };
  }
}

export async function shutdownExecutor() {
  stopNativeHelperClient();
}
