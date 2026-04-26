import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { NativeAction } from "@flowos/shared";

export const swiftHelperSocketPath = "/tmp/flowos-helper.sock";

const execFileAsync = promisify(execFile);

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../../..");
const defaultSwiftHelperPath = path.join(repoRoot, "swift-helper/.build/debug/FlowStateHelper");

export interface SwiftHelperStatus {
  connected: boolean;
  socketPath: string;
  accessibilityReady?: boolean;
  helperPath?: string;
  message?: string;
}

export interface SwiftWindowSnapshot {
  windowId: string;
  pid: number;
  index: number;
  appName: string;
  bundleId?: string;
  title?: string;
  frame?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface SwiftNativeActionResult {
  ok: boolean;
  actionType?: NativeAction["type"];
  message: string;
  window?: SwiftWindowSnapshot;
}

export function getSwiftHelperStatus(): SwiftHelperStatus {
  return {
    connected: false,
    socketPath: swiftHelperSocketPath,
    helperPath: getSwiftHelperPath()
  };
}

export function getSwiftHelperPath(): string {
  return process.env.FLOWOS_SWIFT_HELPER_PATH ?? defaultSwiftHelperPath;
}

async function runSwiftHelper<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync(getSwiftHelperPath(), args, {
    maxBuffer: 1024 * 1024
  });

  return JSON.parse(stdout) as T;
}

export async function getRealSwiftHelperStatus(): Promise<SwiftHelperStatus> {
  const status = await runSwiftHelper<Omit<SwiftHelperStatus, "connected" | "helperPath">>(["status"]);

  return {
    ...status,
    connected: true,
    helperPath: getSwiftHelperPath()
  };
}

export async function requestSwiftAccessibilityPermission(): Promise<SwiftHelperStatus> {
  const status = await runSwiftHelper<Omit<SwiftHelperStatus, "connected" | "helperPath">>([
    "request-accessibility"
  ]);

  return {
    ...status,
    connected: true,
    helperPath: getSwiftHelperPath()
  };
}

export async function listSwiftWindows(): Promise<SwiftWindowSnapshot[]> {
  return runSwiftHelper<SwiftWindowSnapshot[]>(["list-windows"]);
}

export async function executeSwiftNativeAction(action: NativeAction): Promise<SwiftNativeActionResult> {
  return runSwiftHelper<SwiftNativeActionResult>(["run-action", JSON.stringify(action)]);
}
