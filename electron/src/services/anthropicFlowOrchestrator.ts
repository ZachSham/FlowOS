import type { NativeActionResult, SystemSnapshot } from "@flowos/shared";
import { createWindowEditor } from "../actions/windowEditor.js";
import type { NativeHelperBridge } from "../bridge/swiftHelper.js";
import type { TrackingSession } from "./trackingSession.js";

interface FlowOrchestratorOptions {
  bridge: NativeHelperBridge;
  trackingSession: TrackingSession;
}

interface FlowToolUse {
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicAssistantBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicResponse {
  content: AnthropicAssistantBlock[];
  stop_reason: string | null;
}

export interface FlowRunResult {
  ok: boolean;
  summary: string;
  model: string | null;
  snapshotTimestamp: string | null;
  toolCalls: FlowToolUse[];
  toolResults: Array<{
    name: string;
    result: unknown;
  }>;
}

export type ProviderConfig = {
  provider: "anthropic" | "openai";
  apiKey: string;
  model: string;
};

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
}

type InternalMessage = {
  role: "user" | "assistant";
  content: Array<Record<string, unknown>>;
};

const SYSTEM_PROMPT =
  "You are FlowOS's native desktop orchestrator. Use tools carefully, prefer precise window actions, and never invent tool names or fields.";

const TOOL_DEFINITIONS = [
  {
    name: "get_system_snapshot",
    description:
      "Fetch the latest full computer snapshot. Use this before planning and again after actions if you want to verify the layout.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "set_frame",
    description:
      "Move and resize a single window to an exact frame. Requires windowId, x, y, width, and height.",
    input_schema: {
      type: "object",
      properties: {
        windowId: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" }
      },
      required: ["windowId", "x", "y", "width", "height"],
      additionalProperties: false
    }
  },
  {
    name: "move_window",
    description: "Move a single window to an exact x/y position.",
    input_schema: {
      type: "object",
      properties: {
        windowId: { type: "string" },
        x: { type: "number" },
        y: { type: "number" }
      },
      required: ["windowId", "x", "y"],
      additionalProperties: false
    }
  },
  {
    name: "resize_window",
    description: "Resize a single window to an exact width/height.",
    input_schema: {
      type: "object",
      properties: {
        windowId: { type: "string" },
        width: { type: "number" },
        height: { type: "number" }
      },
      required: ["windowId", "width", "height"],
      additionalProperties: false
    }
  },
  {
    name: "raise_window",
    description: "Bring a specific window to the front.",
    input_schema: {
      type: "object",
      properties: {
        windowId: { type: "string" }
      },
      required: ["windowId"],
      additionalProperties: false
    }
  },
  {
    name: "minimize_window",
    description: "Minimize a specific window.",
    input_schema: {
      type: "object",
      properties: {
        windowId: { type: "string" }
      },
      required: ["windowId"],
      additionalProperties: false
    }
  },
  {
    name: "restore_window",
    description: "Restore a previously minimized window.",
    input_schema: {
      type: "object",
      properties: {
        windowId: { type: "string" }
      },
      required: ["windowId"],
      additionalProperties: false
    }
  },
  {
    name: "activate_app",
    description: "Activate a running app by bundleId.",
    input_schema: {
      type: "object",
      properties: {
        bundleId: { type: "string" }
      },
      required: ["bundleId"],
      additionalProperties: false
    }
  },
  {
    name: "hide_app",
    description: "Hide a running app by bundleId.",
    input_schema: {
      type: "object",
      properties: {
        bundleId: { type: "string" }
      },
      required: ["bundleId"],
      additionalProperties: false
    }
  },
  {
    name: "unhide_app",
    description: "Unhide a running app by bundleId.",
    input_schema: {
      type: "object",
      properties: {
        bundleId: { type: "string" }
      },
      required: ["bundleId"],
      additionalProperties: false
    }
  }
] as const;

const TOOL_DEFINITIONS_OPENAI = TOOL_DEFINITIONS.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema
  }
}));

export class AnthropicFlowOrchestrator {
  private readonly bridge: NativeHelperBridge;
  private readonly trackingSession: TrackingSession;

  constructor(options: FlowOrchestratorOptions) {
    this.bridge = options.bridge;
    this.trackingSession = options.trackingSession;
  }

  async enterDevelopFlowMode(): Promise<FlowRunResult> {
    const config = resolveProviderConfig();
    if ("error" in config) {
      return { ok: false, summary: config.error, model: null, snapshotTimestamp: null, toolCalls: [], toolResults: [] };
    }

    const trackingSummary = this.trackingSession.getSummary();
    const messages: InternalMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: buildUserPrompt(trackingSummary) }]
      }
    ];

    const toolCalls: FlowToolUse[] = [];
    const toolResults: Array<{ name: string; result: unknown }> = [];
    let snapshotTimestamp: string | null = null;
    let finalSummary = "Flow mode finished without a final summary.";

    for (let iteration = 0; iteration < 8; iteration += 1) {
      const response = await callProvider({ config, messages });

      messages.push({
        role: "assistant",
        content: response.content as unknown as Array<Record<string, unknown>>
      });

      const text = response.content
        .filter((block): block is AnthropicTextBlock => block.type === "text")
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join("\n");

      if (text) {
        finalSummary = text;
      }

      const toolUses = response.content.filter(
        (block): block is AnthropicToolUseBlock => block.type === "tool_use"
      );

      if (toolUses.length === 0) {
        break;
      }

      const toolResultBlocks: Array<Record<string, unknown>> = [];
      for (const toolUse of toolUses) {
        toolCalls.push({ name: toolUse.name, input: toolUse.input });

        const result = await this.executeTool(toolUse.name, toolUse.input);
        if (isSystemSnapshot(result)) {
          snapshotTimestamp = result.timestamp;
        }

        toolResults.push({ name: toolUse.name, result });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      messages.push({ role: "user", content: toolResultBlocks });
    }

    return { ok: true, summary: finalSummary, model: config.model, snapshotTimestamp, toolCalls, toolResults };
  }

  async runVoiceCommand(transcript: string): Promise<FlowRunResult> {
    const config = resolveProviderConfig();
    if ("error" in config) {
      return { ok: false, summary: config.error, model: null, snapshotTimestamp: null, toolCalls: [], toolResults: [] };
    }

    const messages: InternalMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: buildVoicePrompt(transcript) }]
      }
    ];

    const toolCalls: FlowToolUse[] = [];
    const toolResults: Array<{ name: string; result: unknown }> = [];
    let snapshotTimestamp: string | null = null;
    let finalSummary = "Voice command finished without a summary.";

    for (let iteration = 0; iteration < 8; iteration += 1) {
      const response = await callProvider({ config, messages });

      messages.push({
        role: "assistant",
        content: response.content as unknown as Array<Record<string, unknown>>
      });

      const text = response.content
        .filter((block): block is AnthropicTextBlock => block.type === "text")
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join("\n");

      if (text) {
        finalSummary = text;
      }

      const toolUses = response.content.filter(
        (block): block is AnthropicToolUseBlock => block.type === "tool_use"
      );

      if (toolUses.length === 0) {
        break;
      }

      const toolResultBlocks: Array<Record<string, unknown>> = [];
      for (const toolUse of toolUses) {
        toolCalls.push({ name: toolUse.name, input: toolUse.input });
        const result = await this.executeTool(toolUse.name, toolUse.input);
        if (isSystemSnapshot(result)) {
          snapshotTimestamp = result.timestamp;
        }
        toolResults.push({ name: toolUse.name, result });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      messages.push({ role: "user", content: toolResultBlocks });
    }

    return { ok: true, summary: finalSummary, model: config.model, snapshotTimestamp, toolCalls, toolResults };
  }

  private async executeTool(name: string, input: Record<string, unknown>) {
    const windowEditor = createWindowEditor(this.bridge);

    switch (name) {
      case "get_system_snapshot":
        return this.bridge.request("system.snapshot", {});
      case "set_frame":
        return windowEditor.setFrame(readString(input.windowId, "windowId"), {
          x: readNumber(input.x, "x"),
          y: readNumber(input.y, "y"),
          width: readNumber(input.width, "width"),
          height: readNumber(input.height, "height")
        });
      case "move_window":
        return windowEditor.move(readString(input.windowId, "windowId"), {
          x: readNumber(input.x, "x"),
          y: readNumber(input.y, "y")
        });
      case "resize_window":
        return windowEditor.resize(readString(input.windowId, "windowId"), {
          width: readNumber(input.width, "width"),
          height: readNumber(input.height, "height")
        });
      case "raise_window":
        return windowEditor.raise(readString(input.windowId, "windowId"));
      case "minimize_window":
        return windowEditor.minimize(readString(input.windowId, "windowId"));
      case "restore_window":
        return windowEditor.restore(readString(input.windowId, "windowId"));
      case "activate_app":
        return windowEditor.activateApp(readString(input.bundleId, "bundleId"));
      case "hide_app":
        return windowEditor.hideApp(readString(input.bundleId, "bundleId"));
      case "unhide_app":
        return windowEditor.unhideApp(readString(input.bundleId, "bundleId"));
      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  }
}

export function resolveProviderConfig(): ProviderConfig | { error: string } {
  const provider = (process.env["ORCHESTRATOR_PROVIDER"] ?? "anthropic").toLowerCase();

  if (provider === "openai") {
    const apiKey = process.env["OPENAI_API_KEY"]?.trim();
    if (!apiKey) return { error: "ORCHESTRATOR_PROVIDER=openai but OPENAI_API_KEY is not set." };
    const model = process.env["ORCHESTRATOR_MODEL"]?.trim() || "gpt-4.1";
    return { provider: "openai", apiKey, model };
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"]?.trim();
  if (!apiKey) return { error: "Missing ANTHROPIC_API_KEY in .env" };
  const model = process.env["ORCHESTRATOR_MODEL"]?.trim() || "claude-sonnet-4-0";
  return { provider: "anthropic", apiKey, model };
}

export function buildVoicePrompt(transcript: string): string {
  return [
    `The user said: "${transcript}".`,
    "You are controlling the user's Mac through explicit tools only.",
    "First inspect the current state using get_system_snapshot.",
    "Then execute what the user asked for using only the provided tools.",
    "If the request is ambiguous, make a reasonable interpretation and proceed.",
    "Finish with a short plain-English summary of what you did."
  ].join(" ");
}

function buildUserPrompt(trackingSummary: ReturnType<TrackingSession["getSummary"]>) {
  return [
    "Enter Flow Mode for default develop mode.",
    "You are controlling the user's Mac through explicit tools only.",
    `Tracking summary context: ${JSON.stringify(trackingSummary)}.`,
    "First inspect the current computer state using get_system_snapshot.",
    "Relevant development apps for this mode are: Cursor (com.todesktop.230313mzl4w4u92), Codex (com.openai.codex), GitHub Desktop (com.github.GitHubClient), and Terminal (com.apple.Terminal).",
    "Arrange relevant development windows into a 2x2 layout on the primary display if possible.",
    "Move irrelevant app windows to the second monitor if one exists. If no second monitor exists, hide irrelevant apps instead.",
    "Make sure to minimize ALL irrelevant application or move them to another display so that the 4 focus applications show properly and evenly for the user",
    "Use the provided tool descriptions as the source of truth for available capabilities.",
    "After applying actions, call get_system_snapshot again to verify the layout and call more functions if necessary.",
    "Finish with a short plain-English summary of what you did and any gaps."
  ].join(" ");
}

function toOpenAIMessages(messages: InternalMessage[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const toolResults = msg.content.filter((b) => b["type"] === "tool_result");

      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          result.push({
            role: "tool",
            tool_call_id: String(tr["tool_use_id"] ?? ""),
            content: String(tr["content"] ?? "")
          });
        }
      } else {
        const text = msg.content
          .filter((b) => b["type"] === "text")
          .map((b) => String(b["text"] ?? ""))
          .join("\n");
        result.push({ role: "user", content: text });
      }
    } else {
      const textBlocks = msg.content.filter((b) => b["type"] === "text");
      const toolUses = msg.content.filter((b) => b["type"] === "tool_use");

      if (toolUses.length > 0) {
        result.push({
          role: "assistant",
          content: textBlocks.length > 0
            ? textBlocks.map((b) => String(b["text"] ?? "")).join("\n")
            : null,
          tool_calls: toolUses.map((tu) => ({
            id: String(tu["id"] ?? ""),
            type: "function",
            function: {
              name: String(tu["name"] ?? ""),
              arguments: JSON.stringify(tu["input"] ?? {})
            }
          }))
        });
      } else {
        result.push({
          role: "assistant",
          content: textBlocks.map((b) => String(b["text"] ?? "")).join("\n")
        });
      }
    }
  }

  return result;
}

function normalizeOpenAIResponse(data: OpenAIResponse): AnthropicResponse {
  const message = data.choices[0]?.message;
  const content: AnthropicAssistantBlock[] = [];

  if (message?.content) {
    content.push({ type: "text", text: message.content });
  }

  for (const call of message?.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      input = {};
    }
    content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
  }

  return {
    content,
    stop_reason: data.choices[0]?.finish_reason === "tool_calls" ? "tool_use" : "end_turn"
  };
}

async function callProvider(input: {
  config: ProviderConfig;
  messages: InternalMessage[];
}): Promise<AnthropicResponse> {
  if (input.config.provider === "openai") {
    return callOpenAI({ apiKey: input.config.apiKey, model: input.config.model, messages: input.messages });
  }
  return callAnthropic({ apiKey: input.config.apiKey, model: input.config.model, messages: input.messages });
}

async function callAnthropic(input: {
  apiKey: string;
  model: string;
  messages: InternalMessage[];
}): Promise<AnthropicResponse> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 1400,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      messages: input.messages
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  return (await response.json()) as AnthropicResponse;
}

async function callOpenAI(input: {
  apiKey: string;
  model: string;
  messages: InternalMessage[];
}): Promise<AnthropicResponse> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 1400,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...toOpenAIMessages(input.messages)],
      tools: TOOL_DEFINITIONS_OPENAI
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  return normalizeOpenAIResponse((await response.json()) as OpenAIResponse);
}

function readString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return value;
}

function readNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }

  return value;
}

function isSystemSnapshot(value: unknown): value is SystemSnapshot {
  return Boolean(
    value &&
      typeof value === "object" &&
      "timestamp" in value &&
      "windows" in value &&
      "displays" in value
  );
}
