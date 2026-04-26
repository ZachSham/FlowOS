import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildVoicePrompt, AnthropicFlowOrchestrator } from "./anthropicFlowOrchestrator.js";
import type { NativeHelperBridge } from "../bridge/swiftHelper.js";
import type { TrackingSession } from "./trackingSession.js";

function makeMockBridge(): NativeHelperBridge {
  return {
    request: vi.fn().mockResolvedValue({ applied: true, details: [], warnings: [] }),
    onEvent: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ connected: false, transport: "stdio", command: [] }),
    stop: vi.fn()
  } as unknown as NativeHelperBridge;
}

function makeMockSession(): TrackingSession {
  return {
    getSummary: vi.fn().mockReturnValue({
      isTracking: false,
      startedAt: null,
      eventCount: 0,
      recentEvents: [],
      countsByEvent: {}
    }),
    getState: vi.fn(),
    start: vi.fn(),
    record: vi.fn()
  } as unknown as TrackingSession;
}

function openAITextResponse(text: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: text, tool_calls: undefined }, finish_reason: "stop" }]
    })
  };
}

function openAIToolResponse(toolName: string, toolId: string, args: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: toolId, type: "function", function: { name: toolName, arguments: JSON.stringify(args) } }]
        },
        finish_reason: "tool_calls"
      }]
    })
  };
}

describe("buildVoicePrompt", () => {
  it("includes the transcript verbatim", () => {
    const prompt = buildVoicePrompt("open vscode");
    expect(prompt).toContain("open vscode");
  });

  it("instructs the model to call get_system_snapshot first", () => {
    const prompt = buildVoicePrompt("anything");
    expect(prompt).toContain("get_system_snapshot");
  });

  it("mentions the two-window split tool", () => {
    const prompt = buildVoicePrompt("split terminal and chrome");
    expect(prompt).toContain("split_two_windows");
    expect(prompt).toContain("more than two windows");
  });

  it("does not contain hardcoded flow-mode content", () => {
    const prompt = buildVoicePrompt("minimize terminal");
    expect(prompt).not.toContain("2x2");
    expect(prompt).not.toContain("develop mode");
    expect(prompt).not.toContain("Cursor");
  });
});

describe("AnthropicFlowOrchestrator.runVoiceCommand", () => {
  const savedKey = process.env["OPENAI_API_KEY"];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env["OPENAI_API_KEY"];
    else process.env["OPENAI_API_KEY"] = savedKey;
  });

  it("returns ok:false when OPENAI_API_KEY is missing", async () => {
    delete process.env["OPENAI_API_KEY"];
    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("open vscode");
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("OPENAI_API_KEY");
  });

  it("sends the transcript in the user message", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    const mockFetch = vi.fn().mockResolvedValue(openAITextResponse("Done."));
    vi.stubGlobal("fetch", mockFetch);

    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    await orchestrator.runVoiceCommand("focus on terminal");

    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, { body: string }])[1].body
    ) as { messages: Array<{ role: string; content: string }> };
    const userMsg = body.messages.find((m) => m.role === "user");
    expect(userMsg?.content).toContain("focus on terminal");
  });

  it("calls the OpenAI endpoint", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    const mockFetch = vi.fn().mockResolvedValue(openAITextResponse("Done."));
    vi.stubGlobal("fetch", mockFetch);

    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    await orchestrator.runVoiceCommand("open vscode");

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("openai.com");
  });

  it("returns ok:true with the model's text as summary", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(openAITextResponse("Focused Terminal.")));

    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("focus on terminal");
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Focused Terminal.");
  });

  it("populates toolCalls when the model uses a tool", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount += 1;
      return callCount === 1
        ? openAIToolResponse("activate_app", "t1", { bundleId: "com.apple.Terminal" })
        : openAITextResponse("Activated Terminal.");
    }));

    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("open terminal");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("activate_app");
  });

  it("executes split_two_windows without taking another snapshot", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount += 1;
      return callCount === 1
        ? openAIToolResponse("split_two_windows", "t1", {
            display: { id: "display-1", x: 0, y: 0, width: 1200, height: 800 },
            windowIds: ["ax:1:0", "ax:2:0"],
            gap: 8,
            margin: 12,
            clearFullscreen: false
          })
        : openAITextResponse("Split the windows.");
    }));
    const bridge = makeMockBridge();

    const orchestrator = new AnthropicFlowOrchestrator({
      bridge,
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("split these two windows");

    expect(result.toolCalls[0]?.name).toBe("split_two_windows");
    expect(bridge.request).toHaveBeenCalledWith("window.setFrame", {
      windowId: "ax:1:0",
      x: 12,
      y: 12,
      width: 584,
      height: 776
    });
    expect(bridge.request).toHaveBeenCalledWith("window.setFrame", {
      windowId: "ax:2:0",
      x: 604,
      y: 12,
      width: 584,
      height: 776
    });
    expect(bridge.request).not.toHaveBeenCalledWith("system.snapshot", {});
  });
});
