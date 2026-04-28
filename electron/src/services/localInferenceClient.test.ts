import { afterEach, describe, expect, it, vi } from "vitest";
import { callLocalChatCompletion } from "./localInferenceClient.js";
import type { LocalInferenceConfig } from "./localInferenceConfig.js";

function makeConfig(overrides: Partial<LocalInferenceConfig> = {}): LocalInferenceConfig {
  return {
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5:14b-instruct",
    timeoutMs: 12000,
    strictLocal: true,
    ...overrides
  };
}

describe("callLocalChatCompletion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls local endpoint without auth header when api key is omitted", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] })
    });
    vi.stubGlobal("fetch", mockFetch);

    await callLocalChatCompletion(makeConfig(), {
      messages: [{ role: "user", content: "hello" }]
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(init.headers.authorization).toBeUndefined();
  });

  it("adds bearer auth header when api key is configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] })
    });
    vi.stubGlobal("fetch", mockFetch);

    await callLocalChatCompletion(makeConfig({ apiKey: "local-secret" }), {
      messages: [{ role: "user", content: "hello" }]
    });

    const [, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.authorization).toBe("Bearer local-secret");
  });
});
