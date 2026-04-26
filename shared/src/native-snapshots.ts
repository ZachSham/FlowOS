export interface PermissionSnapshot {
  accessibilityTrusted: boolean;
  screenRecordingGranted: boolean;
}

export interface AppSnapshot {
  bundleId: string;
  name: string;
  pid: number;
  isActive: boolean;
  isHidden: boolean;
}

export interface WindowSnapshot {
  windowId: string;
  bundleId: string;
  appName: string;
  pid: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isFocused: boolean;
  isMain: boolean;
  isMinimized: boolean;
}

export interface DisplaySnapshot {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visibleX: number;
  visibleY: number;
  visibleWidth: number;
  visibleHeight: number;
  scaleFactor: number;
  rotation: number;
  internal: boolean;
  isPrimary: boolean;
}

export interface SystemSnapshot {
  timestamp: string;
  permissions: PermissionSnapshot;
  frontmostApp: AppSnapshot | null;
  runningApps: AppSnapshot[];
  focusedWindow: WindowSnapshot | null;
  windows: WindowSnapshot[];
  displays: DisplaySnapshot[];
}

export interface NativeActionResult {
  applied: boolean;
  details: string[];
  warnings: string[];
}

