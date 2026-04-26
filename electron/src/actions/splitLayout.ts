import type { NativeActionResult } from "@flowos/shared";
import type { WindowEditor } from "./windowEditor.js";

export interface LayoutFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutDisplay extends LayoutFrame {
  id: string;
}

export interface ApplySplitLayoutInput {
  display: LayoutDisplay;
  windowIds: string[];
  gap?: number;
  margin?: number;
  clearFullscreen?: boolean;
}

export interface AppliedSplitWindow {
  windowId: string;
  frame: LayoutFrame;
  result: NativeActionResult;
}

export interface ApplySplitLayoutResult {
  applied: boolean;
  displayId: string;
  displayFrame: LayoutFrame;
  details: string[];
  warnings: string[];
  windows: AppliedSplitWindow[];
}

export async function applySplitLayout(
  editor: WindowEditor,
  input: ApplySplitLayoutInput
): Promise<ApplySplitLayoutResult> {
  const display = validateDisplay(input.display);
  const [leftWindowId, rightWindowId] = validateTwoWindowIds(input.windowIds);
  const gap = input.gap ?? 0;
  const margin = input.margin ?? 0;

  if (gap < 0 || margin < 0) {
    throw new Error("layout.applySplit gap and margin must be non-negative");
  }

  const usableDisplay = insetFrame(display, margin);
  const [leftFrame, rightFrame] = computeTwoSplitFrames(usableDisplay, gap);
  const details: string[] = [];
  const warnings: string[] = [];

  if (input.clearFullscreen ?? true) {
    const clearResult = await editor.clearFullscreenAtLocation(display);
    details.push(...clearResult.details);
    warnings.push(...clearResult.warnings);
  }

  const windows: AppliedSplitWindow[] = [];

  for (const [windowId, frame] of [
    [leftWindowId, leftFrame],
    [rightWindowId, rightFrame]
  ] as const) {
    const result = await editor.setFrame(windowId, frame);
    details.push(...result.details);
    warnings.push(...result.warnings);
    windows.push({ windowId, frame, result });
  }

  return {
    applied: windows.every((window) => window.result.applied),
    displayId: display.id,
    displayFrame: usableDisplay,
    details,
    warnings,
    windows
  };
}

export function computeTwoSplitFrames(
  display: LayoutFrame,
  gap = 0
): [LayoutFrame, LayoutFrame] {
  if (gap < 0) {
    throw new Error("gap must be non-negative");
  }

  const availableWidth = display.width - gap;
  const leftWidth = Math.floor(availableWidth / 2);
  const rightWidth = availableWidth - leftWidth;

  const left: LayoutFrame = {
    x: display.x,
    y: display.y,
    width: leftWidth,
    height: display.height
  };
  const right: LayoutFrame = {
    x: display.x + leftWidth + gap,
    y: display.y,
    width: rightWidth,
    height: display.height
  };

  return [left, right];
}

function insetFrame(frame: LayoutFrame, margin: number): LayoutFrame {
  return validateFrame(
    {
      x: frame.x + margin,
      y: frame.y + margin,
      width: frame.width - margin * 2,
      height: frame.height - margin * 2
    },
    "display"
  );
}

function validateFrame(frame: LayoutFrame, label: string): LayoutFrame {
  const fields = ["x", "y", "width", "height"] as const;
  for (const field of fields) {
    if (!Number.isFinite(frame[field])) {
      throw new Error(`${label}.${field} must be a finite number`);
    }
  }

  if (frame.width <= 0 || frame.height <= 0) {
    throw new Error(`${label}.width and ${label}.height must be positive`);
  }

  return frame;
}

function validateDisplay(display: LayoutDisplay): LayoutDisplay {
  return {
    ...validateFrame(display, "display"),
    id: readNonEmptyString(display.id, "display.id")
  };
}

function validateTwoWindowIds(windowIds: string[]): [string, string] {
  if (!Array.isArray(windowIds) || windowIds.length !== 2) {
    throw new Error("layout.applySplit requires exactly two windowIds");
  }

  return [
    readNonEmptyString(windowIds[0], "windowIds[0]"),
    readNonEmptyString(windowIds[1], "windowIds[1]")
  ];
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return value;
}
