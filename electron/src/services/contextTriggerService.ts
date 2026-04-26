import { net } from "electron";
import type { NativeHelperBridge } from "../bridge/swiftHelper.js";
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

async function callGptForTrigger(
  trackingSession: TrackingSession,
  appName: string | null
): Promise<GptTriggerResponse> {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const model = process.env["OPENAI_MODEL"]?.trim() ?? "gpt-4.1";
  const summary = trackingSession.getSummary();

  const prompt = [
    `The user has been focused on "${appName ?? "unknown"}" for 8 seconds.`,
    `Activity summary: ${JSON.stringify(summary)}.`,
    `Should FlowOS automatically apply a layout? If yes, which mode: "coding" or "research"?`,
    `Respond with JSON only in the form: {"trigger": true|false, "mode": "coding"|"research", "reason": "..."}`,
    `Only set trigger:true if the context strongly suggests a focused work mode. If unsure, set trigger:false.`
  ].join(" ");

  const electronFetch = (net as unknown as { fetch?: typeof fetch } | undefined)?.fetch;
  const activeFetch = electronFetch ?? fetch;

  const response = await activeFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string | null } }>;
  };

  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }

  const parsed = JSON.parse(content) as GptTriggerResponse;

  if (typeof parsed.trigger !== "boolean") {
    throw new Error(`Invalid trigger field: expected boolean, got ${typeof parsed.trigger}`);
  }

  return parsed;
}

export function startContextTriggerService(
  bridge: NativeHelperBridge,
  trackingSession: TrackingSession,
  getFlowStatus: () => "idle" | "running" | "completed" | "failed",
  onTrigger: TriggerCallback
): ContextTriggerHandle {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTriggerAt: number | null = null;
  let lastTriggeredMode: string | null = null;
  let previousApp: string | null = null;
  let stopped = false;

  async function handleDebounceExpired(): Promise<void> {
    debounceTimer = null;

    // Suppress if flow is running
    if (getFlowStatus() === "running") {
      return;
    }

    // Rate limit: skip if last trigger was < 5 minutes ago
    if (lastTriggerAt !== null && Date.now() - lastTriggerAt < RATE_LIMIT_MS) {
      return;
    }

    try {
      const result = await callGptForTrigger(trackingSession, previousApp);

      if (!result.trigger) {
        return;
      }

      const mode = result.mode;

      // Dedup: skip if GPT returns same mode as last triggered mode
      if (mode === lastTriggeredMode) {
        return;
      }

      if (stopped) {
        return;
      }

      lastTriggerAt = Date.now();
      lastTriggeredMode = mode;
      onTrigger(mode);
    } catch (err) {
      console.error("[contextTriggerService] GPT call failed:", err);
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
