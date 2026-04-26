import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildVoicePrompt, AnthropicFlowOrchestrator } from "./anthropicFlowOrchestrator.js";
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

describe("buildVoicePrompt", () => {
  it("includes the transcript verbatim", () => {
    const prompt = buildVoicePrompt("open vscode");
    expect(prompt).toContain("open vscode");
  });

  it("instructs Claude to call get_system_snapshot first", () => {
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

describe("AnthropicFlowOrchestrator.runVoiceCommand", () => {
  const originalKey = process.env["ANTHROPIC_API_KEY"];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env["ANTHROPIC_API_KEY"];
    } else {
      process.env["ANTHROPIC_API_KEY"] = originalKey;
    }
  });

  it("returns ok:false when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("open vscode");
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("ANTHROPIC_API_KEY");
  });

  it("includes transcript in the first user message sent to the API", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Opened VS Code." }],
        stop_reason: "end_turn"
      })
    });
    vi.stubGlobal("fetch", mockFetch);

    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    await orchestrator.runVoiceCommand("focus on terminal");

    const callBody = JSON.parse(
      (mockFetch.mock.calls[0] as [string, { body: string }])[1].body
    ) as { messages: Array<{ role: string; content: Array<{ type: string; text: string }> }> };
    expect(callBody.messages[0]?.content[0]?.text).toContain("focus on terminal");
  });

  it("returns ok:true with the API text as summary on success", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Focused Terminal window." }],
          stop_reason: "end_turn"
        })
      })
    );

    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("focus on terminal");
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Focused Terminal window.");
  });

  it("returns toolCalls populated when Claude uses tools", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({
              content: [
                { type: "tool_use", id: "t1", name: "activate_app", input: { bundleId: "com.apple.Terminal" } }
              ],
              stop_reason: "tool_use"
            })
          };
        }
        return {
          ok: true,
          json: async () => ({
            content: [{ type: "text", text: "Activated Terminal." }],
            stop_reason: "end_turn"
          })
        };
      })
    );

    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("open terminal");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("activate_app");
  });
});
