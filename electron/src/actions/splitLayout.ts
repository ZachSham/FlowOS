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
  const windowIds = validateWindowIds(input.windowIds);
  const gap = input.gap ?? 0;
  const margin = input.margin ?? 0;

  if (gap < 0 || margin < 0) {
    throw new Error("layout.applySplit gap and margin must be non-negative");
  }

  const usableDisplay = insetFrame(display, margin);
  const frames = computeSplitFrames(usableDisplay, windowIds.length, gap);
  const details: string[] = [];
  const warnings: string[] = [];

  if (input.clearFullscreen ?? true) {
    const clearResult = await editor.clearFullscreenAtLocation(display);
    details.push(...clearResult.details);
    warnings.push(...clearResult.warnings);
  }

  const windows: AppliedSplitWindow[] = [];

  for (const [index, windowId] of windowIds.entries()) {
    const frame = frames[index];
    if (!frame) {
      continue;
    }

    const result = await editor.setFrame(windowId, frame);
    details.push(...result.details);
    warnings.push(...result.warnings);
    windows.push({
      windowId,
      frame,
      result
    });
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

export function computeSplitFrames(display: LayoutFrame, count: number, gap = 0): LayoutFrame[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("count must be a positive integer");
  }

  if (count <= 3) {
    return splitRow(display, count, gap);
  }

  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const rowFrames = splitColumn(display, rows, gap);
  const frames: LayoutFrame[] = [];

  for (const [rowIndex, rowFrame] of rowFrames.entries()) {
    const remaining = count - frames.length;
    const columnsInRow = Math.min(columns, remaining);
    const rowCells = splitRow(rowFrame, columnsInRow, gap);
    frames.push(...rowCells);

    if (rowIndex === rowFrames.length - 1) {
      break;
    }
  }

  return frames.slice(0, count);
}

function splitRow(frame: LayoutFrame, columns: number, gap: number): LayoutFrame[] {
  const totalGap = gap * (columns - 1);
  const availableWidth = frame.width - totalGap;
  const widths = splitLength(availableWidth, columns);

  let x = frame.x;
  return widths.map((width) => {
    const cell = {
      x,
      y: frame.y,
      width,
      height: frame.height
    };
    x += width + gap;
    return cell;
  });
}

function splitColumn(frame: LayoutFrame, rows: number, gap: number): LayoutFrame[] {
  const totalGap = gap * (rows - 1);
  const availableHeight = frame.height - totalGap;
  const heights = splitLength(availableHeight, rows);

  let y = frame.y;
  return heights.map((height) => {
    const cell = {
      x: frame.x,
      y,
      width: frame.width,
      height
    };
    y += height + gap;
    return cell;
  });
}

function splitLength(length: number, parts: number): number[] {
  const base = Math.floor(length / parts);
  const remainder = Math.round(length - base * parts);

  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
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

function validateWindowIds(windowIds: string[]): string[] {
  if (!Array.isArray(windowIds) || windowIds.length === 0) {
    throw new Error("layout.applySplit requires at least one windowId");
  }

  return windowIds.map((windowId) => readNonEmptyString(windowId, "windowId"));
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return value;
}
