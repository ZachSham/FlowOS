import { parseVoiceTranscript } from "./parser.mjs";

const KNOWN_APPS = [
  {
    bundleId: "com.microsoft.VSCode",
    aliases: ["vscode", "vs code", "visual studio code", "code"]
  },
  {
    bundleId: "com.google.Chrome",
    aliases: ["chrome", "google chrome"]
  },
  {
    bundleId: "com.apple.Terminal",
    aliases: ["terminal"]
  },
  {
    bundleId: "com.apple.Safari",
    aliases: ["safari"]
  }
];

const COMMAND_TYPES = [
  "helper.status",
  "system.list_windows",
  "system.list_screens",
  "permissions.open_accessibility_settings",
  "app.activate",
  "app.hide",
  "app.unhide",
  "window.raise",
  "window.minimize",
  "window.restore",
  "window.move",
  "window.resize",
  "window.setFrame",
  "window.move_relative",
  "window.move_to_other_screen"
];

const DIRECTION_VALUES = ["left", "right", "up", "down"];
const AMOUNT_VALUES = ["small", "medium", "large"];
const NULLABLE_DIRECTION_VALUES = [...DIRECTION_VALUES, null];
const NULLABLE_AMOUNT_VALUES = [...AMOUNT_VALUES, null];

const COMMAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "type",
    "target",
    "bundleId",
    "appName",
    "windowId",
    "direction",
    "amount",
    "x",
    "y",
    "width",
    "height"
  ],
  properties: {
    type: {
      type: "string",
      enum: COMMAND_TYPES
    },
    target: {
      type: ["string", "null"]
    },
    bundleId: {
      type: ["string", "null"]
    },
    appName: {
      type: ["string", "null"]
    },
    windowId: {
      type: ["string", "null"]
    },
    direction: {
      type: ["string", "null"],
      enum: NULLABLE_DIRECTION_VALUES
    },
    amount: {
      type: ["string", "null"],
      enum: NULLABLE_AMOUNT_VALUES
    },
    x: {
      type: ["number", "null"]
    },
    y: {
      type: ["number", "null"]
    },
    width: {
      type: ["number", "null"]
    },
    height: {
      type: ["number", "null"]
    }
  }
};

function envEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeWord(input) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s._\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveKnownBundleId(bundleId, appName) {
  const bundle = String(bundleId ?? "").trim();
  if (/^[a-zA-Z0-9_.\-]+$/.test(bundle) && bundle.includes(".")) {
    return bundle;
  }

  const normalizedAppName = normalizeWord(appName);
  if (!normalizedAppName) {
    return null;
  }

  for (const app of KNOWN_APPS) {
    if (app.aliases.includes(normalizedAppName)) {
      return app.bundleId;
    }
  }

  return null;
}

function normalizeWindowId(windowId) {
  const normalized = String(windowId ?? "").trim().toLowerCase();
  if (!/^ax:\d+:\d+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeTarget(target, bundleId) {
  const normalizedTarget = String(target ?? "").trim();
  if (normalizedTarget === "frontmost") {
    return "frontmost";
  }

  if (normalizedTarget.startsWith("app:")) {
    const rawBundleId = normalizedTarget.slice(4);
    const normalizedBundleId = resolveKnownBundleId(rawBundleId, null);
    if (normalizedBundleId) {
      return `app:${normalizedBundleId}`;
    }
  }

  const normalizedBundleId = resolveKnownBundleId(bundleId, null);
  if (normalizedBundleId) {
    return `app:${normalizedBundleId}`;
  }

  return "frontmost";
}

function buildNativeRequestCommand(method, payload) {
  return `NATIVE_REQUEST method=${method} payload=${JSON.stringify(payload)}`;
}

function buildFlowCommand(type, fields = {}) {
  const tokens = ["FLOW_COMMAND", `type=${type}`];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    tokens.push(`${key}=${String(value)}`);
  }

  return tokens.join(" ");
}

function compileLlmCommand(candidate) {
  const type = String(candidate?.type ?? "").trim();
  if (!COMMAND_TYPES.includes(type)) {
    return {
      ok: false,
      message: `Unsupported command type from LLM: ${type || "<empty>"}`
    };
  }

  const bundleId = resolveKnownBundleId(candidate.bundleId, candidate.appName);
  const windowId = normalizeWindowId(candidate.windowId);

  if (type === "helper.status") {
    return { ok: true, commandString: buildFlowCommand(type) };
  }

  if (type === "system.list_windows") {
    return { ok: true, commandString: buildFlowCommand(type) };
  }

  if (type === "system.list_screens") {
    return { ok: true, commandString: buildFlowCommand(type) };
  }

  if (type === "permissions.open_accessibility_settings") {
    return { ok: true, commandString: buildFlowCommand(type) };
  }

  if (type === "app.activate") {
    if (!bundleId) {
      return { ok: false, message: "LLM command app.activate requires a valid bundleId." };
    }

    return {
      ok: true,
      commandString: buildNativeRequestCommand("app.activate", { bundleId })
    };
  }

  if (type === "app.unhide") {
    if (!bundleId) {
      return { ok: false, message: "LLM command app.unhide requires a valid bundleId." };
    }

    return {
      ok: true,
      commandString: buildNativeRequestCommand("app.unhide", { bundleId })
    };
  }

  if (type === "app.hide") {
    if (bundleId) {
      return {
        ok: true,
        commandString: buildNativeRequestCommand("app.hide", { bundleId })
      };
    }

    return {
      ok: true,
      commandString: buildFlowCommand("app.hide", {
        target: normalizeTarget(candidate.target, bundleId)
      })
    };
  }

  if (type === "window.move_relative") {
    const direction = DIRECTION_VALUES.includes(candidate.direction) ? candidate.direction : "right";
    const amount = AMOUNT_VALUES.includes(candidate.amount) ? candidate.amount : "medium";

    return {
      ok: true,
      commandString: buildFlowCommand(type, {
        target: normalizeTarget(candidate.target, bundleId),
        direction,
        amount
      })
    };
  }

  if (type === "window.move_to_other_screen") {
    return {
      ok: true,
      commandString: buildFlowCommand(type, {
        target: normalizeTarget(candidate.target, bundleId)
      })
    };
  }

  if (type === "window.raise" || type === "window.minimize" || type === "window.restore") {
    if (windowId) {
      return {
        ok: true,
        commandString: buildNativeRequestCommand(type, {
          windowId
        })
      };
    }

    return {
      ok: true,
      commandString: buildFlowCommand(type, {
        target: normalizeTarget(candidate.target, bundleId)
      })
    };
  }

  if (type === "window.move") {
    if (!windowId || !isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y)) {
      return {
        ok: false,
        message: "LLM command window.move requires windowId, x, and y."
      };
    }

    return {
      ok: true,
      commandString: buildNativeRequestCommand(type, {
        windowId,
        x: candidate.x,
        y: candidate.y
      })
    };
  }

  if (type === "window.resize") {
    if (!windowId || !isFiniteNumber(candidate.width) || !isFiniteNumber(candidate.height)) {
      return {
        ok: false,
        message: "LLM command window.resize requires windowId, width, and height."
      };
    }

    return {
      ok: true,
      commandString: buildNativeRequestCommand(type, {
        windowId,
        width: candidate.width,
        height: candidate.height
      })
    };
  }

  if (type === "window.setFrame") {
    if (
      !windowId ||
      !isFiniteNumber(candidate.x) ||
      !isFiniteNumber(candidate.y) ||
      !isFiniteNumber(candidate.width) ||
      !isFiniteNumber(candidate.height)
    ) {
      return {
        ok: false,
        message: "LLM command window.setFrame requires windowId, x, y, width, and height."
      };
    }

    return {
      ok: true,
      commandString: buildNativeRequestCommand(type, {
        windowId,
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height
      })
    };
  }

  return {
    ok: false,
    message: `Unsupported command type from LLM compiler: ${type}`
  };
}

function buildSystemPrompt() {
  return [
    "You map spoken FlowOS desktop commands to a strict command JSON object.",
    "Output must follow the schema exactly.",
    "Use only supported types.",
    "Prefer app bundle IDs when known.",
    "Known app bundle IDs:",
    "- vscode => com.microsoft.VSCode",
    "- chrome => com.google.Chrome",
    "- terminal => com.apple.Terminal",
    "- safari => com.apple.Safari",
    "If command implies 'this window' use target='frontmost' unless a windowId is explicitly provided.",
    "For move relative use direction and amount (small|medium|large)."
  ].join("\n");
}

function parseFirstJsonObject(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }

  if (Array.isArray(raw)) {
    const combinedText = raw
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("")
      .trim();

    if (!combinedText) {
      throw new Error("LLM returned empty array content.");
    }

    return JSON.parse(combinedText);
  }

  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    throw new Error("LLM returned empty response.");
  }

  return JSON.parse(trimmed);
}

async function requestLlmCandidate(rawTranscript, normalizedTranscript) {
  const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const model = String(process.env.VOICE_LAB_LLM_MODEL ?? "gpt-4.1-mini").trim();
  const baseUrl = String(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const timeoutMs = Number(process.env.VOICE_LAB_LLM_TIMEOUT_MS ?? "8000");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 8000);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt()
          },
          {
            role: "user",
            content: JSON.stringify({
              transcript: rawTranscript,
              normalizedTranscript
            })
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "flowos_voice_command",
            strict: true,
            schema: COMMAND_SCHEMA
          }
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const failureBody = await response.text();
      throw new Error(`LLM API request failed (${response.status}): ${failureBody}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    return parseFirstJsonObject(content);
  } finally {
    clearTimeout(timer);
  }
}

function llmDisabledResult(baseResult) {
  return {
    ...baseResult,
    parser: "deterministic",
    llmFallbackUsed: false
  };
}

export function isLlmFallbackEnabled() {
  return envEnabled(process.env.VOICE_LAB_LLM_ENABLED);
}

export async function parseVoiceTranscriptWithFallback(rawTranscript) {
  const baseResult = parseVoiceTranscript(rawTranscript);
  if (baseResult.ok) {
    return llmDisabledResult(baseResult);
  }

  if (!isLlmFallbackEnabled()) {
    return llmDisabledResult(baseResult);
  }

  try {
    const candidate = await requestLlmCandidate(rawTranscript, baseResult.normalizedTranscript);
    const compiled = compileLlmCommand(candidate);

    if (!compiled.ok || !compiled.commandString) {
      return {
        ...baseResult,
        parser: "deterministic",
        llmFallbackUsed: true,
        llmFallbackError: compiled.message ?? "LLM output could not be compiled."
      };
    }

    return {
      ok: true,
      intent: `llm_${candidate.type}`,
      transcript: rawTranscript,
      normalizedTranscript: baseResult.normalizedTranscript,
      commandString: compiled.commandString,
      message: "Parsed by LLM fallback.",
      parser: "llm",
      llmFallbackUsed: true,
      llmCandidate: candidate
    };
  } catch (error) {
    return {
      ...baseResult,
      parser: "deterministic",
      llmFallbackUsed: true,
      llmFallbackError: error instanceof Error ? error.message : "LLM parse failed"
    };
  }
}
