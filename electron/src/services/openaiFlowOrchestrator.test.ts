import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildVoicePrompt, OpenAIFlowOrchestrator } from "./openaiFlowOrchestrator.js";
import type { NativeHelperBridge } from "../bridge/swiftHelper.js";
import type { TrackingSession } from "./trackingSession.js";

function makeMockBridge(): NativeHelperBridge {
  return {
    request: vi.fn().mockResolvedValue({ ok: true }),
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

  it("does not contain hardcoded flow-mode content", () => {
    const prompt = buildVoicePrompt("minimize terminal");
    expect(prompt).not.toContain("2x2");
    expect(prompt).not.toContain("develop mode");
    expect(prompt).not.toContain("Cursor");
  });
});

describe("OpenAIFlowOrchestrator.runVoiceCommand", () => {
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
    const orchestrator = new OpenAIFlowOrchestrator({
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

  it("calls the OpenAI endpoint", async () => {
    process.env["OPENAI_API_KEY"] = "test-key";
    const mockFetch = vi.fn().mockResolvedValue(openAITextResponse("Done."));
    vi.stubGlobal("fetch", mockFetch);

    const orchestrator = new OpenAIFlowOrchestrator({
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

    const orchestrator = new OpenAIFlowOrchestrator({
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

    const orchestrator = new OpenAIFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("open terminal");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("activate_app");
  });
});
