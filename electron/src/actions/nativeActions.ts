import type { NativeAction } from "@flowos/shared";

type JsonRecord = Record<string, unknown>;

export type NativeActionValidationResult =
  | {
      ok: true;
      action: NativeAction;
    }
  | {
      ok: false;
      errors: string[];
    };

export interface MockNativeActionResult {
  ok: boolean;
  actionType?: NativeAction["type"];
  message: string;
  validationErrors?: string[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasStringField(record: JsonRecord, field: string): boolean {
  return typeof record[field] === "string" && record[field].length > 0;
}

function validatePosition(record: unknown, path: string): string[] {
  if (!isRecord(record)) {
    return [`${path} is required`];
  }

  const errors: string[] = [];

  if (!isNumber(record.x)) {
    errors.push(`${path}.x is required`);
  }

  if (!isNumber(record.y)) {
    errors.push(`${path}.y is required`);
  }

  return errors;
}

function validateSize(record: unknown, path: string): string[] {
  if (!isRecord(record)) {
    return [`${path} is required`];
  }

  const errors: string[] = [];

  if (!isNumber(record.width)) {
    errors.push(`${path}.width is required`);
  } else if (record.width <= 0) {
    errors.push(`${path}.width must be positive`);
  }

  if (!isNumber(record.height)) {
    errors.push(`${path}.height is required`);
  } else if (record.height <= 0) {
    errors.push(`${path}.height must be positive`);
  }

  return errors;
}

function validateFrame(record: unknown): string[] {
  if (!isRecord(record)) {
    return ["frame is required"];
  }

  return [...validatePosition(record, "frame"), ...validateSize(record, "frame")];
}

export function validateNativeAction(action: unknown): NativeActionValidationResult {
  if (!isRecord(action)) {
    return {
      ok: false,
      errors: ["action must be an object"]
    };
  }

  const errors: string[] = [];

  if (typeof action.type !== "string") {
    return {
      ok: false,
      errors: ["type is required"]
    };
  }

  switch (action.type) {
    case "native.window.setFrame":
      if (!hasStringField(action, "windowId")) {
        errors.push("windowId is required");
      }
      errors.push(...validateFrame(action.frame));
      break;

    case "native.window.move":
      if (!hasStringField(action, "windowId")) {
        errors.push("windowId is required");
      }
      errors.push(...validatePosition(action.position, "position"));
      break;

    case "native.window.resize":
      if (!hasStringField(action, "windowId")) {
        errors.push("windowId is required");
      }
      errors.push(...validateSize(action.size, "size"));
      break;

    case "native.window.raise":
      if (!hasStringField(action, "windowId")) {
        errors.push("windowId is required");
      }
      break;

    case "native.app.activate":
      if (!hasStringField(action, "bundleId")) {
        errors.push("bundleId is required");
      }
      break;

    default:
      errors.push(`unsupported native action type: ${action.type}`);
      break;
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors
    };
  }

  return {
    ok: true,
    action: action as unknown as NativeAction
  };
}

export async function executeMockNativeAction(action: unknown): Promise<MockNativeActionResult> {
  const validation = validateNativeAction(action);

  if (!validation.ok) {
    console.log("[mock-native] rejected action", {
      action,
      errors: validation.errors
    });

    return {
      ok: false,
      message: "Native action failed validation",
      validationErrors: validation.errors
    };
  }

  console.log("[mock-native] would execute action", validation.action);

  return {
    ok: true,
    actionType: validation.action.type,
    message: "Mock native action succeeded"
  };
}
