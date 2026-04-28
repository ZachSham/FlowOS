import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildVoicePrompt, OpenAIFlowOrchestrator } from "./openaiFlowOrchestrator.js";
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

function localTextResponse(text: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: text, tool_calls: undefined }, finish_reason: "stop" }]
    })
  };
}

function localToolResponse(toolName: string, toolId: string, args: Record<string, unknown>) {
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

describe("OpenAIFlowOrchestrator.runVoiceCommand", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env["FLOWOS_INFERENCE_BASE_URL"] = "http://127.0.0.1:11434/v1";
    process.env["FLOWOS_INFERENCE_MODEL"] = "qwen2.5:14b-instruct";
    process.env["FLOWOS_INFERENCE_STRICT_LOCAL"] = "1";
    delete process.env["FLOWOS_INFERENCE_API_KEY"];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }

    for (const [key, value] of Object.entries(savedEnv)) {
      process.env[key] = value;
    }
  });

  it("returns ok:false when strict local mode is disabled", async () => {
    process.env["FLOWOS_INFERENCE_STRICT_LOCAL"] = "0";
    const orchestrator = new OpenAIFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("open vscode");
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("FLOWOS_INFERENCE_STRICT_LOCAL");
  });

  it("sends the transcript in the user message", async () => {
    const mockFetch = vi.fn().mockResolvedValue(localTextResponse("Done."));
    vi.stubGlobal("fetch", mockFetch);

    const orchestrator = new OpenAIFlowOrchestrator({
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

  it("calls the local inference endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue(localTextResponse("Done."));
    vi.stubGlobal("fetch", mockFetch);

    const orchestrator = new OpenAIFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    await orchestrator.runVoiceCommand("open vscode");

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("http://127.0.0.1:11434/v1/chat/completions");
  });

  it("returns ok:false with clear summary when local inference is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));

    const orchestrator = new OpenAIFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("focus on terminal");
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Local inference unavailable");
  });

  it("returns ok:true with the model text as summary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(localTextResponse("Focused Terminal.")));

    const orchestrator = new OpenAIFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("focus on terminal");
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Focused Terminal.");
  });

  it("populates toolCalls when the model uses a tool", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount += 1;
      return callCount === 1
        ? localToolResponse("activate_app", "t1", { bundleId: "com.apple.Terminal" })
        : localTextResponse("Activated Terminal.");
    }));

    const orchestrator = new OpenAIFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("open terminal");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("activate_app");
  });

  it("executes split_two_windows without taking another snapshot", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount += 1;
      return callCount === 1
        ? localToolResponse("split_two_windows", "t1", {
            display: { id: "display-1", x: 0, y: 0, width: 1200, height: 800 },
            windowIds: ["ax:1:0", "ax:2:0"],
            gap: 8,
            margin: 12,
            clearFullscreen: false
          })
        : localTextResponse("Split the windows.");
    }));
    const bridge = makeMockBridge();

    const orchestrator = new OpenAIFlowOrchestrator({
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
    expect(
      (bridge.request as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([method]) => method === "system.snapshot"
      )
    ).toHaveLength(1);
  });
});
