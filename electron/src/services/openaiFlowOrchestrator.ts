import type {
  ChromeCommand,
  ChromeCommandPayloadMap,
  ChromeCommandResultMap,
  ChromeSnapshot,
  NativeActionResult,
  SystemSnapshot
} from "@flowos/shared";
import { net } from "electron";
import { applySplitLayout } from "../actions/splitLayout.js";
import { createWindowEditor } from "../actions/windowEditor.js";
import type { NativeHelperBridge } from "../bridge/swiftHelper.js";
import type { TrackingSession } from "./trackingSession.js";

type RunChromeCommand = <C extends ChromeCommand>(
  command: C,
  payload: ChromeCommandPayloadMap[C]
) => Promise<ChromeCommandResultMap[C]>;

interface FlowOrchestratorOptions {
  bridge: NativeHelperBridge;
  trackingSession: TrackingSession;
  getChromeSnapshot?: () => ChromeSnapshot | null;
  runChromeCommand?: RunChromeCommand;
}

interface FlowToolUse {
  name: string;
  input: Record<string, unknown>;
}

interface TextBlock {
  type: "text";
  text: string;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AssistantBlock = TextBlock | ToolUseBlock;

interface LLMResponse {
  content: AssistantBlock[];
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
    type: "function" as const,
    function: {
      name: "get_system_snapshot",
      description:
        "Fetch the latest full computer snapshot. Use this before planning and again after actions if you want to verify the layout.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "set_frame",
      description:
        "Move and resize a single window to an exact frame. Requires windowId, x, y, width, and height.",
      parameters: {
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
    }
  },
  {
    type: "function" as const,
    function: {
      name: "split_two_windows",
      description:
        "Place exactly two windows side by side within a display frame from get_system_snapshot. Use this for two-window split screen requests. For more than two windows, use set_frame, move_window, and resize_window instead.",
      parameters: {
        type: "object",
        properties: {
          display: {
            type: "object",
            description:
              "The target display frame copied from get_system_snapshot. Use visibleX/visibleY/visibleWidth/visibleHeight when the user wants the usable visible area.",
            properties: {
              id: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" }
            },
            required: ["id", "x", "y", "width", "height"],
            additionalProperties: false
          },
          windowIds: {
            type: "array",
            description: "Exactly two window IDs in left-to-right order.",
            items: { type: "string" },
            minItems: 2,
            maxItems: 2
          },
          gap: { type: "number", description: "Optional pixels between windows. Defaults to 0." },
          margin: {
            type: "number",
            description: "Optional pixels inset from the display edges. Defaults to 0."
          },
          clearFullscreen: {
            type: "boolean",
            description: "Whether to clear fullscreen at the target location before moving windows. Defaults to true."
          }
        },
        required: ["display", "windowIds"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "move_window",
      description: "Move a single window to an exact x/y position.",
      parameters: {
        type: "object",
        properties: {
          windowId: { type: "string" },
          x: { type: "number" },
          y: { type: "number" }
        },
        required: ["windowId", "x", "y"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "resize_window",
      description: "Resize a single window to an exact width/height.",
      parameters: {
        type: "object",
        properties: {
          windowId: { type: "string" },
          width: { type: "number" },
          height: { type: "number" }
        },
        required: ["windowId", "width", "height"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "raise_window",
      description: "Bring a specific window to the front.",
      parameters: {
        type: "object",
        properties: { windowId: { type: "string" } },
        required: ["windowId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "minimize_window",
      description: "Minimize a specific window.",
      parameters: {
        type: "object",
        properties: { windowId: { type: "string" } },
        required: ["windowId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "restore_window",
      description: "Restore a previously minimized window.",
      parameters: {
        type: "object",
        properties: { windowId: { type: "string" } },
        required: ["windowId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "activate_app",
      description: "Activate a running app by bundleId.",
      parameters: {
        type: "object",
        properties: { bundleId: { type: "string" } },
        required: ["bundleId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "hide_app",
      description: "Hide a running app by bundleId.",
      parameters: {
        type: "object",
        properties: { bundleId: { type: "string" } },
        required: ["bundleId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "unhide_app",
      description: "Unhide a running app by bundleId.",
      parameters: {
        type: "object",
        properties: { bundleId: { type: "string" } },
        required: ["bundleId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_chrome_snapshot",
      description:
        "Fetch the latest Chrome tab snapshot from the browser extension. Call this BEFORE any Chrome tab manipulation. Returns tabs with id, title, url, windowId, groupId, pinned, active, etc.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "focus_chrome_tab",
      description: "Focus a specific Chrome tab by tabId and bring its window to the front.",
      parameters: {
        type: "object",
        properties: { tabId: { type: "number" } },
        required: ["tabId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "group_chrome_tabs",
      description:
        "Create a new Chrome tab group containing the given tabIds. Optional title, color, and target windowId.",
      parameters: {
        type: "object",
        properties: {
          tabIds: { type: "array", items: { type: "number" }, minItems: 1 },
          title: { type: "string" },
          color: {
            type: "string",
            enum: ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]
          },
          windowId: { type: "number" }
        },
        required: ["tabIds"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "ungroup_chrome_tabs",
      description: "Remove the given Chrome tabIds from any tab group they belong to.",
      parameters: {
        type: "object",
        properties: {
          tabIds: { type: "array", items: { type: "number" }, minItems: 1 }
        },
        required: ["tabIds"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "pin_chrome_tab",
      description: "Pin or unpin a Chrome tab by tabId.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number" },
          pinned: { type: "boolean" }
        },
        required: ["tabId", "pinned"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "open_chrome_tab",
      description:
        "Open a new Chrome tab with the given url. Optional active, pinned, windowId. Prefer this over closing tabs.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          active: { type: "boolean" },
          pinned: { type: "boolean" },
          windowId: { type: "number" }
        },
        required: ["url"],
        additionalProperties: false
      }
    }
  }
];

export class OpenAIFlowOrchestrator {
  private readonly bridge: NativeHelperBridge;
  private readonly trackingSession: TrackingSession;
  private readonly getChromeSnapshot?: () => ChromeSnapshot | null;
  private readonly runChromeCommand?: RunChromeCommand;

  constructor(options: FlowOrchestratorOptions) {
    this.bridge = options.bridge;
    this.trackingSession = options.trackingSession;
    this.getChromeSnapshot = options.getChromeSnapshot;
    this.runChromeCommand = options.runChromeCommand;
  }

  async enterDevelopFlowMode(): Promise<FlowRunResult> {
    const { apiKey, model, error } = resolveOpenAIConfig();
    if (error) {
      return { ok: false, summary: error, model: null, snapshotTimestamp: null, toolCalls: [], toolResults: [] };
    }

    const trackingSummary = this.trackingSession.getSummary();
    const initialSystemSnapshot = await this.safeSystemSnapshot();
    const initialChromeSnapshot = this.safeChromeSnapshot();
    return this.runLoop({
      apiKey: apiKey!,
      model: model!,
      initialPrompt: buildFlowModePrompt(trackingSummary, initialSystemSnapshot, initialChromeSnapshot),
      emptySummary: "Flow mode finished without a final summary."
    });
  }

  async runVoiceCommand(transcript: string): Promise<FlowRunResult> {
    const { apiKey, model, error } = resolveOpenAIConfig();
    if (error) {
      return { ok: false, summary: error, model: null, snapshotTimestamp: null, toolCalls: [], toolResults: [] };
    }

    const trackingSummary = this.trackingSession.getSummary();
    const initialSystemSnapshot = await this.safeSystemSnapshot();
    const initialChromeSnapshot = this.safeChromeSnapshot();
    return this.runLoop({
      apiKey: apiKey!,
      model: model!,
      initialPrompt: buildVoicePrompt(
        transcript,
        initialSystemSnapshot,
        initialChromeSnapshot,
        trackingSummary
      ),
      emptySummary: "Voice command finished without a summary."
    });
  }

  private async safeSystemSnapshot(): Promise<SystemSnapshot | null> {
    try {
      return (await this.bridge.request("system.snapshot", {})) as SystemSnapshot;
    } catch {
      return null;
    }
  }

  private safeChromeSnapshot(): ChromeSnapshot | null {
    try {
      return this.getChromeSnapshot?.() ?? null;
    } catch {
      return null;
    }
  }

  private async runLoop(input: {
    apiKey: string;
    model: string;
    initialPrompt: string;
    emptySummary: string;
  }): Promise<FlowRunResult> {
    const messages: InternalMessage[] = [
      { role: "user", content: [{ type: "text", text: input.initialPrompt }] }
    ];

    const toolCalls: FlowToolUse[] = [];
    const toolResults: Array<{ name: string; result: unknown }> = [];
    let snapshotTimestamp: string | null = null;
    let finalSummary = input.emptySummary;

    for (let iteration = 0; iteration < 20; iteration += 1) {
      const response = await callOpenAI({ apiKey: input.apiKey, model: input.model, messages });

      messages.push({
        role: "assistant",
        content: response.content as unknown as Array<Record<string, unknown>>
      });

      const text = response.content
        .filter((block): block is TextBlock => block.type === "text")
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join("\n");

      if (text) finalSummary = text;

      const toolUses = response.content.filter(
        (block): block is ToolUseBlock => block.type === "tool_use"
      );

      if (toolUses.length === 0) break;

      const toolResultBlocks: Array<Record<string, unknown>> = [];
      for (const toolUse of toolUses) {
        toolCalls.push({ name: toolUse.name, input: toolUse.input });
        const result = await this.executeTool(toolUse.name, toolUse.input);
        if (isSystemSnapshot(result)) snapshotTimestamp = result.timestamp;
        toolResults.push({ name: toolUse.name, result });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      messages.push({ role: "user", content: toolResultBlocks });
    }

    return { ok: true, summary: finalSummary, model: input.model, snapshotTimestamp, toolCalls, toolResults };
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
      case "split_two_windows":
        return applySplitLayout(windowEditor, {
          display: readDisplay(input.display, "display"),
          windowIds: readTwoWindowIds(input.windowIds, "windowIds"),
          gap: readOptionalNumber(input.gap, "gap"),
          margin: readOptionalNumber(input.margin, "margin"),
          clearFullscreen: readOptionalBoolean(input.clearFullscreen, "clearFullscreen")
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
      case "get_chrome_snapshot":
        return this.getChromeSnapshot?.() ?? {
          ok: false,
          error: "Chrome snapshot is not available. The Chrome extension is not connected."
        };
      case "focus_chrome_tab":
        return this.requireChromeRunner()(
          "chrome.tab.focus",
          { tabId: readNumber(input.tabId, "tabId") }
        );
      case "group_chrome_tabs":
        return this.requireChromeRunner()(
          "chrome.tabs.group",
          {
            tabIds: readNumberArray(input.tabIds, "tabIds"),
            ...(typeof input.title === "string" ? { title: input.title } : {}),
            ...(typeof input.color === "string"
              ? { color: input.color as ChromeCommandPayloadMap["chrome.tabs.group"]["color"] }
              : {}),
            ...(typeof input.windowId === "number" ? { windowId: input.windowId } : {})
          }
        );
      case "ungroup_chrome_tabs":
        return this.requireChromeRunner()(
          "chrome.tabs.ungroup",
          { tabIds: readNumberArray(input.tabIds, "tabIds") }
        );
      case "pin_chrome_tab":
        return this.requireChromeRunner()(
          "chrome.tab.pin",
          {
            tabId: readNumber(input.tabId, "tabId"),
            pinned: readBoolean(input.pinned, "pinned")
          }
        );
      case "open_chrome_tab":
        return this.requireChromeRunner()(
          "chrome.tab.open",
          {
            url: readString(input.url, "url"),
            ...(typeof input.active === "boolean" ? { active: input.active } : {}),
            ...(typeof input.pinned === "boolean" ? { pinned: input.pinned } : {}),
            ...(typeof input.windowId === "number" ? { windowId: input.windowId } : {})
          }
        );
      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  }

  private requireChromeRunner(): RunChromeCommand {
    if (!this.runChromeCommand) {
      throw new Error(
        "Chrome command runner is not configured. Wire runChromeCommand into the orchestrator."
      );
    }
    return this.runChromeCommand;
  }
}

function resolveOpenAIConfig(): { apiKey?: string; model?: string; error?: string } {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) return { error: "OPENAI_API_KEY is not set." };
  const model = process.env["OPENAI_MODEL"]?.trim() || "gpt-4.1-mini";
  return { apiKey, model };
}

const DISPLAY_GEOMETRY_RULES =
  "Window geometry: coordinates are global across all displays - never assume (0,0). " +
  "Always use the target display's visibleX/visibleY/visibleWidth/visibleHeight (not width/height) and scale per-display. " +
  "For an R x C tile: cellW = visibleWidth/C, cellH = visibleHeight/R, slot(row,col) = { x: visibleX + col*cellW, y: visibleY + row*cellH, width: cellW, height: cellH }. " +
  "State tracking: the initial snapshot ages the moment you call any move/resize/focus/hide tool. Either keep an internal map of the windowId -> latest {x, y, width, height} you set so subsequent decisions use post-action positions, OR call get_system_snapshot to refresh - and definitely refresh every ~5 mutating tool calls, before any verification step, and after any display add/remove in tracking. Never base a new placement on the stale initial snapshot once you have started moving things. " +
  "Before any split / tile / multi-window arrangement, confirm the windowIds and target display rect are still current; if anything has been moved, resized, opened, or closed since the latest snapshot, call get_system_snapshot first so the placement is accurate.";

export function buildVoicePrompt(
  transcript: string,
  initialSystemSnapshot: SystemSnapshot | null = null,
  initialChromeSnapshot: ChromeSnapshot | null = null,
  trackingSummary: ReturnType<TrackingSession["getSummary"]> | null = null
): string {
  return [
    `The user said: "${transcript}".`,
    "You are controlling the user's Mac through explicit tools only.",
    `Initial system snapshot context: ${JSON.stringify(initialSystemSnapshot)}.`,
    `Initial Chrome snapshot context: ${JSON.stringify(initialChromeSnapshot)}.`,
    `Tracking summary context (recent app/space activity if user pressed Start Tracking): ${JSON.stringify(trackingSummary)}.`,
    "Treat the snapshots above as the most recent ground truth; if you need fresher state call get_system_snapshot or get_chrome_snapshot.",
    "Use the tracking summary only when the request references recent history (e.g. 'go back to what I was doing', 'reopen the last app'). If isTracking is false the summary will be empty - that is fine.",
    DISPLAY_GEOMETRY_RULES,
    "For two-window split screen requests, use split_two_windows with display dimensions from the snapshot; for more than two windows, use set_frame, move_window, and resize_window.",
    "Before any Google Chrome tab manipulation (focus / group / ungroup / pin / open), call get_chrome_snapshot to confirm tab ids, urls, and window ids.",
    "If the user refers to 'this window' or 'my current window', ignore the FlowOS control window and act on the likely active external user window.",
    "Interpret 'other desktop' as the other physical display or monitor, not a macOS Space.",
    "Never close or delete Chrome tabs. Avoid destructive actions.",
    "Then execute what the user asked for using only the provided tools.",
    "If the request is ambiguous, make a reasonable interpretation and proceed.",
    "If the user asks to split / tile / arrange N windows across a display, the windows must FILL that display: for each window call BOTH resize_window (to the cell size) AND move_window (to the cell origin). Do not just move windows at their current size, that leaves gaps and overlaps. If it asks for even splits, make sure the size for windows is truly split evenly so the user can see both properly. Use proper UX intution.",
    "If a tool call fails for one target (e.g. one window can't be raised on a Sidecar/iPad display), do not abort: continue with the remaining targets and mention any skipped items in the final summary.",
    "Finish with a short plain-English summary of what you did, including any per-target failures."
  ].join(" ");
}

function buildFlowModePrompt(
  trackingSummary: ReturnType<TrackingSession["getSummary"]>,
  initialSystemSnapshot: SystemSnapshot | null,
  initialChromeSnapshot: ChromeSnapshot | null
) {
  return [
    "Enter Flow Mode for default develop mode.",
    "You are controlling the user's Mac through explicit tools only.",
    `Tracking summary context: ${JSON.stringify(trackingSummary)}.`,
    `Initial system snapshot context: ${JSON.stringify(initialSystemSnapshot)}.`,
    `Initial Chrome snapshot context: ${JSON.stringify(initialChromeSnapshot)}.`,
    "Treat the snapshots above as the most recent ground truth; call get_system_snapshot or get_chrome_snapshot again only if you need fresher data after acting.",
    DISPLAY_GEOMETRY_RULES,
    "Relevant development apps for this mode are: Cursor (com.todesktop.230313mzl4w4u92), Codex (com.openai.codex), GitHub Desktop (com.github.GitHubClient), and Terminal (com.apple.Terminal).",
    "Use split_two_windows when arranging exactly two windows side by side, passing display dimensions from the snapshot.",
    "If arranging more than two windows, use set_frame, move_window, and resize_window instead of split_two_windows.",
    "Arrange relevant development windows into a 2x2 layout on the primary display using the geometry rules above (compute slots from the primary display's visibleX/visibleY/visibleWidth/visibleHeight).",
    "Move irrelevant app windows to the second monitor if one exists, sized to fit that display's visible rect; if no second monitor exists, hide irrelevant apps instead.",
    "Make sure to minimize ALL irrelevant application or move them to another display so that the 4 focus applications show properly and evenly for the user.",
    "Before any Google Chrome tab manipulation, call get_chrome_snapshot to refresh tab/group/window state, then organize tabs by topic into tab groups.",
    "Consolidate related tabs across multiple Chrome windows when useful by grouping them into a chosen target window.",
    "Never close or delete Chrome tabs whatsoever. Prefer grouping, ungrouping, pinning, focusing.",
    "Use the provided tool descriptions as the source of truth for available capabilities.",
    "If a tool call fails for one target (e.g. one window can't be raised on a Sidecar/iPad display), do not abort: continue with the remaining targets and mention any skipped items in the final summary.",
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

function normalizeOpenAIResponse(data: OpenAIResponse): LLMResponse {
  const message = data.choices[0]?.message;
  const content: AssistantBlock[] = [];

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

async function callOpenAI(input: {
  apiKey: string;
  model: string;
  messages: InternalMessage[];
}): Promise<LLMResponse> {
  const electronFetch = (net as unknown as { fetch?: typeof fetch } | undefined)?.fetch;
  const activeFetch = electronFetch ?? fetch;

  const response = await activeFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...toOpenAIMessages(input.messages)],
      tools: TOOL_DEFINITIONS
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

function readBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function readOptionalNumber(value: unknown, label: string) {
  if (value === undefined) return undefined;
  return readNumber(value, label);
}

function readOptionalBoolean(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function readNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty number array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw new Error(`${label}[${index}] must be a finite number`);
    }
    return entry;
  });
}

function readDisplay(value: unknown, label: string) {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }

  const record = value as Record<string, unknown>;
  return {
    id: readString(record.id, `${label}.id`),
    x: readNumber(record.x, `${label}.x`),
    y: readNumber(record.y, `${label}.y`),
    width: readNumber(record.width, `${label}.width`),
    height: readNumber(record.height, `${label}.height`)
  };
}

function readTwoWindowIds(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must contain exactly two window IDs`);
  }
  return value.map((windowId, index) => readString(windowId, `${label}[${index}]`));
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
