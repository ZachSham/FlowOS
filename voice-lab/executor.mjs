import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseVoiceTranscript } from "./parser.mjs";

const execFileAsync = promisify(execFile);

const voiceLabDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(voiceLabDir, "..");
const helperRelativePath = "swift-helper/.build/debug/FlowStateHelper";
const helperAbsolutePath = path.join(repoRoot, helperRelativePath);

function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout.trim();
  }
}

function isFlowCommand(commandString) {
  return commandString.startsWith("FLOW_COMMAND ");
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

async function runHelper(args) {
  try {
    const { stdout } = await execFileAsync(helperAbsolutePath, args, {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 4
    });

    return {
      ok: true,
      output: parseJsonOutput(stdout)
    };
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const parsedOutput = parseJsonOutput(stdout || stderr || "");
    const parsedMessage =
      parsedOutput &&
      typeof parsedOutput === "object" &&
      "message" in parsedOutput &&
      typeof parsedOutput.message === "string"
        ? parsedOutput.message
        : undefined;
    const message =
      parsedMessage ||
      (typeof error?.message === "string" && error.message) ||
      stderr.trim() ||
      stdout.trim() ||
      "Unknown helper execution error";

    return {
      ok: false,
      output: parsedOutput,
      error: message
    };
  }
}

async function runAction(action) {
  return runHelper(["run-action", JSON.stringify(action)]);
}

async function getFrontmostBundleId() {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to get bundle identifier of first application process whose frontmost is true'
    ]);

    const bundleId = stdout.trim();
    return bundleId.length > 0 ? bundleId : undefined;
  } catch {
    return undefined;
  }
}

function hasFrame(windowSnapshot) {
  return Boolean(windowSnapshot?.frame);
}

function isFlowOsWindow(windowSnapshot) {
  const appName = String(windowSnapshot?.appName ?? "").toLowerCase();
  const bundleId = String(windowSnapshot?.bundleId ?? "").toLowerCase();
  return appName.includes("flowos") || bundleId.includes("flowos");
}

function isInternalWindow(windowSnapshot) {
  const appName = String(windowSnapshot?.appName ?? "").toLowerCase();
  const bundleId = String(windowSnapshot?.bundleId ?? "").toLowerCase();

  return (
    isFlowOsWindow(windowSnapshot) ||
    appName.includes("codex") ||
    bundleId === "com.openai.codex"
  );
}

function pickWindowForBundle(windows, bundleId) {
  return windows.find((windowSnapshot) => hasFrame(windowSnapshot) && windowSnapshot.bundleId === bundleId);
}

async function resolveTargetWindow(target) {
  const windowResult = await runHelper(["list-windows"]);
  if (!windowResult.ok || !Array.isArray(windowResult.output)) {
    return {
      ok: false,
      message: "Failed to read windows from helper.",
      details: windowResult
    };
  }

  const windows = windowResult.output;
  const framedWindows = windows.filter(hasFrame);

  if (framedWindows.length === 0) {
    return {
      ok: false,
      message: "No movable windows found."
    };
  }

  if (target.startsWith("app:")) {
    const bundleId = target.slice(4);
    const appWindow = pickWindowForBundle(framedWindows, bundleId);

    if (appWindow) {
      return {
        ok: true,
        window: appWindow
      };
    }

    return {
      ok: false,
      message: `No visible window found for app target ${bundleId}.`
    };
  }

  const frontmostBundleId = await getFrontmostBundleId();
  if (frontmostBundleId) {
    const frontmostWindow = pickWindowForBundle(framedWindows, frontmostBundleId);
    if (frontmostWindow && !isInternalWindow(frontmostWindow)) {
      return {
        ok: true,
        window: frontmostWindow
      };
    }
  }

  const nonInternalWindow = framedWindows.find((windowSnapshot) => !isInternalWindow(windowSnapshot));
  return {
    ok: true,
    window: nonInternalWindow ?? framedWindows[0]
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

function sortScreens(screens) {
  return [...screens].sort((a, b) => {
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

function locateCurrentScreen(frame, screens) {
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;

  const byCenter = screens.findIndex((screen) => containsPoint(screen, centerX, centerY));
  if (byCenter >= 0) {
    return byCenter;
  }

  let bestIndex = 0;
  let bestOverlap = -1;

  for (const [index, screenSnapshot] of screens.entries()) {
    const overlap = overlapArea(frame, screenSnapshot);
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

function computeFrameOnNextScreen(frame, screens) {
  const sorted = sortScreens(screens);
  const currentIndex = locateCurrentScreen(frame, sorted);
  const currentScreen = sorted[currentIndex] ?? sorted[0];

  if (!currentScreen) {
    return frame;
  }

  const targetScreen = sorted[(currentIndex + 1) % sorted.length] ?? currentScreen;
  const width = Math.min(frame.width, targetScreen.width);
  const height = Math.min(frame.height, targetScreen.height);

  const sourceCenterXRatio = clamp(
    (frame.x + frame.width / 2 - currentScreen.x) / Math.max(currentScreen.width, 1),
    0,
    1
  );
  const sourceCenterYRatio = clamp(
    (frame.y + frame.height / 2 - currentScreen.y) / Math.max(currentScreen.height, 1),
    0,
    1
  );

  const targetCenterX = targetScreen.x + targetScreen.width * sourceCenterXRatio;
  const targetCenterY = targetScreen.y + targetScreen.height * sourceCenterYRatio;

  const x = clamp(targetCenterX - width / 2, targetScreen.x, targetScreen.x + targetScreen.width - width);
  const y = clamp(targetCenterY - height / 2, targetScreen.y, targetScreen.y + targetScreen.height - height);

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
  if (!targetWindowResult.ok || !targetWindowResult.window?.frame) {
    return {
      ok: false,
      message: targetWindowResult.message ?? "Unable to resolve target window for move command.",
      details: targetWindowResult
    };
  }

  const currentFrame = targetWindowResult.window.frame;
  const delta = parseAmountToDelta(amount);

  let nextX = currentFrame.x;
  let nextY = currentFrame.y;

  if (direction === "left") {
    nextX -= delta;
  } else if (direction === "right") {
    nextX += delta;
  } else if (direction === "up") {
    nextY -= delta;
  } else if (direction === "down") {
    nextY += delta;
  }

  const result = await runAction({
    type: "native.window.move",
    windowId: targetWindowResult.window.windowId,
    position: {
      x: nextX,
      y: nextY
    }
  });

  return {
    ok: result.ok,
    message: result.ok ? "Window move command executed." : result.error ?? "Window move command failed.",
    targetWindow: targetWindowResult.window,
    helper: result
  };
}

async function executeMoveToOtherScreen(flowCommand) {
  const target = flowCommand.target ?? "frontmost";
  const targetWindowResult = await resolveTargetWindow(target);

  if (!targetWindowResult.ok || !targetWindowResult.window?.frame) {
    return {
      ok: false,
      message: targetWindowResult.message ?? "Unable to resolve target window for move-to-other-screen command.",
      details: targetWindowResult
    };
  }

  const screenResult = await runHelper(["list-screens"]);
  if (!screenResult.ok || !Array.isArray(screenResult.output)) {
    return {
      ok: false,
      message: "Failed to read screens from helper.",
      details: screenResult
    };
  }

  const screens = screenResult.output;
  if (screens.length < 2) {
    return {
      ok: false,
      message: "At least two screens are required."
    };
  }

  const nextFrame = computeFrameOnNextScreen(targetWindowResult.window.frame, screens);
  const result = await runAction({
    type: "native.window.setFrame",
    windowId: targetWindowResult.window.windowId,
    frame: nextFrame
  });

  return {
    ok: result.ok,
    message: result.ok
      ? "Move-to-other-screen command executed."
      : result.error ?? "Move-to-other-screen command failed.",
    targetWindow: targetWindowResult.window,
    targetFrame: nextFrame,
    helper: result
  };
}

async function executeMinimize(flowCommand) {
  const target = flowCommand.target ?? "frontmost";
  const targetWindowResult = await resolveTargetWindow(target);

  if (!targetWindowResult.ok || !targetWindowResult.window?.windowId) {
    return {
      ok: false,
      message: targetWindowResult.message ?? "Unable to resolve target window for minimize command.",
      details: targetWindowResult
    };
  }

  const result = await runAction({
    type: "native.window.minimize",
    windowId: targetWindowResult.window.windowId
  });

  return {
    ok: result.ok,
    message: result.ok ? "Window minimized." : result.error ?? "Minimize command failed.",
    targetWindow: targetWindowResult.window,
    helper: result
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

  if (flowCommand.type === "window.move_relative") {
    return executeMoveRelative(flowCommand);
  }

  if (flowCommand.type === "window.move_to_other_screen") {
    return executeMoveToOtherScreen(flowCommand);
  }

  if (flowCommand.type === "window.minimize") {
    return executeMinimize(flowCommand);
  }

  return {
    ok: false,
    message: `Unsupported flow command type: ${flowCommand.type}`
  };
}

function extractRunActionPayload(commandString) {
  const match = commandString.match(/run-action\s+'(.+)'$/);
  if (!match?.[1]) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function executeHelperCommand(commandString) {
  if (commandString.endsWith(" status")) {
    return runHelper(["status"]);
  }

  if (commandString.endsWith(" request-accessibility")) {
    return runHelper(["request-accessibility"]);
  }

  if (commandString.endsWith(" list-windows")) {
    return runHelper(["list-windows"]);
  }

  if (commandString.endsWith(" list-screens")) {
    return runHelper(["list-screens"]);
  }

  if (commandString.includes(" run-action ")) {
    const action = extractRunActionPayload(commandString);
    if (!action) {
      return {
        ok: false,
        error: "Could not decode run-action payload from command string."
      };
    }

    return runAction(action);
  }

  return {
    ok: false,
    error: "Unsupported helper command format."
  };
}

export async function executeTranscript(transcript) {
  const parsed = parseVoiceTranscript(transcript);

  if (!parsed.ok || !parsed.commandString) {
    return {
      ok: false,
      parsed,
      message: parsed.message
    };
  }

  const execution = isFlowCommand(parsed.commandString)
    ? await executeFlowCommand(parsed.commandString)
    : await executeHelperCommand(parsed.commandString);

  return {
    ok: Boolean(execution.ok),
    parsed,
    execution,
    message: execution.ok ? "Command executed." : execution.message ?? execution.error ?? "Execution failed."
  };
}
