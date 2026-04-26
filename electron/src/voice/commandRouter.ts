import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { screen } from "electron";
import type { VoiceCommandResult } from "@flowos/shared";
import type { SwiftWindowSnapshot } from "../bridge/swiftHelper.js";
import { listSwiftWindows } from "../bridge/swiftHelper.js";
import { WindowEditor } from "../actions/windowEditor.js";

const execFileAsync = promisify(execFile);
const windowEditor = new WindowEditor();

type AppCommandConfig = {
  bundleId: string;
  label: string;
  matchers: string[];
};

const appCommandConfigs: AppCommandConfig[] = [
  {
    bundleId: "com.microsoft.VSCode",
    label: "VS Code",
    matchers: ["vscode", "vs code", "visual studio code", "code"]
  },
  {
    bundleId: "com.google.Chrome",
    label: "Google Chrome",
    matchers: ["chrome", "google chrome"]
  },
  {
    bundleId: "com.apple.Terminal",
    label: "Terminal",
    matchers: ["terminal"]
  },
  {
    bundleId: "com.apple.Safari",
    label: "Safari",
    matchers: ["safari"]
  }
];

type ParsedCommand =
  | {
      intent: "activate_app";
      bundleId: string;
      appLabel: string;
    }
  | {
      intent: "move_window_to_other_screen";
    }
  | {
      intent: "unknown";
    };

interface WindowWithFrame extends SwiftWindowSnapshot {
  frame: NonNullable<SwiftWindowSnapshot["frame"]>;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizeTranscript(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(input: string, patterns: string[]): boolean {
  return patterns.some((pattern) => input.includes(pattern));
}

function parseCommand(normalizedTranscript: string): ParsedCommand {
  const activationVerbs = ["open", "launch", "focus", "switch", "activate", "start"];
  const wantsActivation = includesAny(normalizedTranscript, activationVerbs);

  for (const app of appCommandConfigs) {
    const appMentioned = includesAny(normalizedTranscript, app.matchers);
    if (!appMentioned) {
      continue;
    }

    if (wantsActivation || app.matchers.some((matcher) => normalizedTranscript === matcher)) {
      return {
        intent: "activate_app",
        bundleId: app.bundleId,
        appLabel: app.label
      };
    }
  }

  const mentionsMove = includesAny(normalizedTranscript, ["move", "send", "put"]);
  const mentionsWindow = includesAny(normalizedTranscript, ["window", "this"]);
  const mentionsDisplay = includesAny(normalizedTranscript, ["screen", "monitor", "display"]);
  const mentionsOtherDisplay = includesAny(normalizedTranscript, ["other", "another", "next"]);

  if (mentionsMove && mentionsWindow && mentionsDisplay && mentionsOtherDisplay) {
    return {
      intent: "move_window_to_other_screen"
    };
  }

  return {
    intent: "unknown"
  };
}

function hasFrame(window: SwiftWindowSnapshot): window is WindowWithFrame {
  return Boolean(window.frame);
}

function isFlowOsWindow(window: SwiftWindowSnapshot): boolean {
  const appName = window.appName.toLowerCase();
  const bundleId = window.bundleId?.toLowerCase() ?? "";
  return appName.includes("flowos") || bundleId.includes("flowos");
}

async function getFrontmostBundleId(): Promise<string | undefined> {
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

function pickTargetWindow(
  windows: SwiftWindowSnapshot[],
  frontmostBundleId?: string
): WindowWithFrame | undefined {
  const windowsWithFrame = windows.filter(hasFrame);

  if (windowsWithFrame.length === 0) {
    return undefined;
  }

  if (frontmostBundleId) {
    const frontmostWindows = windowsWithFrame.filter((window) => window.bundleId === frontmostBundleId);
    const nonFlowFrontmost = frontmostWindows.find((window) => !isFlowOsWindow(window));

    if (nonFlowFrontmost) {
      return nonFlowFrontmost;
    }

    if (frontmostWindows[0]) {
      return frontmostWindows[0];
    }
  }

  const nonFlowWindow = windowsWithFrame.find((window) => !isFlowOsWindow(window));
  return nonFlowWindow ?? windowsWithFrame[0];
}

function sortRects(rects: Rect[]): Rect[] {
  return [...rects].sort((a, b) => {
    if (a.x !== b.x) {
      return a.x - b.x;
    }

    return a.y - b.y;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function overlapArea(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  if (right <= left || bottom <= top) {
    return 0;
  }

  return (right - left) * (bottom - top);
}

function locateCurrentDisplay(frame: Rect, displays: Rect[]): number {
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;
  const byCenterIndex = displays.findIndex((display) => containsPoint(display, centerX, centerY));

  if (byCenterIndex >= 0) {
    return byCenterIndex;
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

function computeFrameOnNextDisplay(frame: Rect, displays: Rect[]): Rect {
  const currentDisplayIndex = locateCurrentDisplay(frame, displays);
  const currentDisplay = displays[currentDisplayIndex] ?? displays[0];

  if (!currentDisplay) {
    return frame;
  }

  const targetDisplay = displays[(currentDisplayIndex + 1) % displays.length] ?? currentDisplay;
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

  return { x, y, width, height };
}

function result(
  params: Omit<VoiceCommandResult, "normalizedTranscript" | "transcript"> & {
    transcript: string;
    normalizedTranscript: string;
  }
): VoiceCommandResult {
  return {
    ok: params.ok,
    transcript: params.transcript,
    normalizedTranscript: params.normalizedTranscript,
    intent: params.intent,
    message: params.message,
    actionType: params.actionType
  };
}

function unknownCommandResult(transcript: string, normalizedTranscript: string): VoiceCommandResult {
  return result({
    ok: false,
    transcript,
    normalizedTranscript,
    intent: "unknown",
    message:
      "Command not recognized. Try: 'open vscode' or 'move this window to the other screen'."
  });
}

export async function runVoiceCommand(transcript: string): Promise<VoiceCommandResult> {
  const normalizedTranscript = normalizeTranscript(transcript);

  if (!normalizedTranscript) {
    return unknownCommandResult(transcript, normalizedTranscript);
  }

  const parsed = parseCommand(normalizedTranscript);

  try {
    if (parsed.intent === "activate_app") {
      const actionResult = await windowEditor.activateApp(parsed.bundleId);

      return result({
        ok: actionResult.ok,
        transcript,
        normalizedTranscript,
        intent: parsed.intent,
        message: actionResult.ok
          ? `Activated ${parsed.appLabel}.`
          : `Failed to activate ${parsed.appLabel}: ${actionResult.message}`,
        actionType: actionResult.actionType
      });
    }

    if (parsed.intent === "move_window_to_other_screen") {
      const windows = await listSwiftWindows();
      const frontmostBundleId = await getFrontmostBundleId();
      const targetWindow = pickTargetWindow(windows, frontmostBundleId);

      if (!targetWindow?.frame) {
        return result({
          ok: false,
          transcript,
          normalizedTranscript,
          intent: parsed.intent,
          message: "Could not find a movable window. Keep a regular app window focused and try again."
        });
      }

      const displays = sortRects(
        screen.getAllDisplays().map((display) => ({
          x: display.workArea.x,
          y: display.workArea.y,
          width: display.workArea.width,
          height: display.workArea.height
        }))
      );

      if (displays.length < 2) {
        return result({
          ok: false,
          transcript,
          normalizedTranscript,
          intent: parsed.intent,
          message: "At least two displays are required for this command."
        });
      }

      const nextFrame = computeFrameOnNextDisplay(targetWindow.frame, displays);
      const actionResult = await windowEditor.setFrame(targetWindow.windowId, nextFrame);

      return result({
        ok: actionResult.ok,
        transcript,
        normalizedTranscript,
        intent: parsed.intent,
        message: actionResult.ok
          ? `Moved ${targetWindow.appName} to the other screen.`
          : `Failed to move window: ${actionResult.message}`,
        actionType: actionResult.actionType
      });
    }

    return unknownCommandResult(transcript, normalizedTranscript);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown voice command error";

    return result({
      ok: false,
      transcript,
      normalizedTranscript,
      intent: parsed.intent,
      message
    });
  }
}
