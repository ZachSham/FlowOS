import type { NativeHelperBridge } from "../bridge/swiftHelper.js";
import {
  resolveLocalInferenceConfig,
  type LocalInferenceConfig
} from "./localInferenceConfig.js";
import { callLocalChatCompletion } from "./localInferenceClient.js";
import type { TrackingSession } from "./trackingSession.js";

export type TriggerCallback = (mode: "coding" | "research") => void;

export interface ContextTriggerHandle {
  stop: () => void;
}

const DEBOUNCE_MS = 8_000;
const RATE_LIMIT_MS = 5 * 60 * 1000;

interface GptTriggerResponse {
  trigger: boolean;
  mode: "coding" | "research";
  reason: string;
}

function parseFirstJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Empty response from local inference.");
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }

    throw new Error(`Unparseable response: ${trimmed}`);
  }
}

async function callGptForTrigger(
  inferenceConfig: LocalInferenceConfig,
  trackingSession: TrackingSession,
  appName: string | null
): Promise<GptTriggerResponse> {
  const summary = trackingSession.getSummary();

  const prompt = [
    `The user has been focused on "${appName ?? "unknown"}" for 8 seconds.`,
    `Activity summary: ${JSON.stringify(summary)}.`,
    "Should FlowOS automatically apply a layout? If yes, which mode: \"coding\" or \"research\"?",
    "Respond with JSON only in the form: {\"trigger\": true|false, \"mode\": \"coding\"|\"research\", \"reason\": \"...\"}",
    "Only set trigger:true if the context strongly suggests a focused work mode. If unsure, set trigger:false."
  ].join(" ");

  const response = await callLocalChatCompletion(inferenceConfig, {
    model: inferenceConfig.model,
    temperature: 0,
    max_tokens: 100,
    messages: [{ role: "user", content: prompt }]
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from local inference.");
  }

  const parsed = parseFirstJsonObject(content);

  if (typeof parsed.trigger !== "boolean") {
    throw new Error(`Invalid trigger field: expected boolean, got ${typeof parsed.trigger}`);
  }

  if (parsed.mode !== "coding" && parsed.mode !== "research") {
    throw new Error(`Invalid mode from local inference: ${String(parsed.mode)}`);
  }

  return {
    trigger: parsed.trigger,
    mode: parsed.mode,
    reason: typeof parsed.reason === "string" ? parsed.reason : ""
  };
}

export function startContextTriggerService(
  bridge: NativeHelperBridge,
  trackingSession: TrackingSession,
  getFlowStatus: () => "idle" | "running" | "completed" | "failed",
  onTrigger: TriggerCallback
): ContextTriggerHandle {
  const inferenceConfigResult = resolveLocalInferenceConfig();
  const inferenceConfig = inferenceConfigResult.ok ? inferenceConfigResult.value : null;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTriggerAt: number | null = null;
  let lastTriggeredMode: "coding" | "research" | null = null;
  let previousApp: string | null = null;
  let stopped = false;

  async function handleDebounceExpired(): Promise<void> {
    debounceTimer = null;

    if (stopped) {
      return;
    }

    if (!inferenceConfig) {
      console.error(
        `[contextTriggerService] disabled: ${inferenceConfigResult.ok ? "unknown config error" : inferenceConfigResult.error}`
      );
      return;
    }

    // Suppress if flow is running
    if (getFlowStatus() === "running") {
      return;
    }

    // Rate limit: skip if last trigger was < 5 minutes ago
    if (lastTriggerAt !== null && Date.now() - lastTriggerAt < RATE_LIMIT_MS) {
      return;
    }

    try {
      const result = await callGptForTrigger(inferenceConfig, trackingSession, previousApp);

      // Update rate-limit timestamp after every successful inference call, regardless
      // of whether it fires a trigger, so local model calls are bounded.
      lastTriggerAt = Date.now();

      if (!result.trigger) {
        return;
      }

      const mode = result.mode;

      // Dedup: skip if model returns same mode as last triggered mode
      if (mode === lastTriggeredMode) {
        return;
      }

      if (stopped) {
        return;
      }

      lastTriggeredMode = mode;
      onTrigger(mode);
    } catch (err) {
      console.error("[contextTriggerService] local inference call failed:", err);
    }
  }

  const removeListener = bridge.onEvent((event: unknown) => {
    if (stopped) return;

    const envelope = event as { kind?: string; event?: string; payload?: unknown };
    if (envelope.event !== "app.activated") {
      return;
    }

    const payload = envelope.payload as { app?: { name?: string } };
    const appName = payload.app?.name ?? null;
    previousApp = appName;

    // Reset debounce timer
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      void handleDebounceExpired();
    }, DEBOUNCE_MS);
  });

  return {
    stop() {
      stopped = true;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      removeListener();
    }
  };
}
