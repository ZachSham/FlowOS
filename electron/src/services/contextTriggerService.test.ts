import { describe, it, expect, vi, beforeEach } from "vitest";
import { createContextTriggerService } from "./contextTriggerService.js";

vi.useFakeTimers();

// Mock analyzer that returns coding when VSCode is active, research for Safari
function mockAnalyze(_events: unknown[], bundleId: string) {
  if (bundleId.toLowerCase().includes("vscode") || bundleId.toLowerCase().includes("xcode")) {
    return { mode: "coding", confidence: 0.85, signals: ["VSCode active", "IDE detected"] };
  }
  if (bundleId.toLowerCase().includes("safari") || bundleId.toLowerCase().includes("chrome")) {
    return { mode: "research", confidence: 0.75, signals: ["Browser active"] };
  }
  return { mode: "unclear", confidence: 0.1, signals: [] };
}

describe("createContextTriggerService", () => {
  let onSuggestion: ReturnType<typeof vi.fn>;
  let service: ReturnType<typeof createContextTriggerService>;

  beforeEach(() => {
    onSuggestion = vi.fn();
    service = createContextTriggerService({ onSuggestion: onSuggestion as (s: import("./contextTriggerService.js").TriggerSuggestion) => void, debounceMs: 100, analyze: mockAnalyze });
  });

  it("does not fire before debounce window", () => {
    service.onAppActivated("com.apple.Xcode", []);
    vi.advanceTimersByTime(50);
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it("fires after debounce window with a suggestion", () => {
    service.onAppActivated("com.microsoft.VSCode", []);
    vi.advanceTimersByTime(150);
    expect(onSuggestion).toHaveBeenCalledOnce();
    const suggestion = onSuggestion.mock.calls[0]?.[0] as { kind: string };
    expect(suggestion.kind).toBe("mode_suggestion");
  });

  it("resets debounce on rapid app switches", () => {
    service.onAppActivated("com.microsoft.VSCode", []);
    vi.advanceTimersByTime(50);
    service.onAppActivated("com.apple.Safari", []);
    vi.advanceTimersByTime(50);
    expect(onSuggestion).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(onSuggestion).toHaveBeenCalledOnce();
  });

  it("does not fire if tracking is already active in the same mode", () => {
    service.setActiveMode("coding");
    service.onAppActivated("com.microsoft.VSCode", []);
    vi.advanceTimersByTime(200);
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it("dispose cancels pending debounce", () => {
    service.onAppActivated("com.microsoft.VSCode", []);
    service.dispose();
    vi.advanceTimersByTime(200);
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it("fires again after mode changes away from suggested mode", () => {
    service.setActiveMode("coding");
    // Switch away from coding
    service.setActiveMode("research");
    service.onAppActivated("com.microsoft.VSCode", []);
    vi.advanceTimersByTime(150);
    // VSCode → coding suggestion, active mode is research → should fire
    expect(onSuggestion).toHaveBeenCalledOnce();
    expect((onSuggestion.mock.calls[0]?.[0] as { suggestedMode: string }).suggestedMode).toBe("coding");
  });

  it("does not fire for low-confidence result (unclear)", () => {
    const lowConfidenceAnalyze = () => ({ mode: "unclear", confidence: 0.1, signals: [] });
    const localService = createContextTriggerService({
      onSuggestion: onSuggestion as (s: import("./contextTriggerService.js").TriggerSuggestion) => void,
      debounceMs: 100,
      analyze: lowConfidenceAnalyze,
    });
    localService.onAppActivated("com.unknown.app", []);
    vi.advanceTimersByTime(200);
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it("does not fire for mixed mode result", () => {
    const mixedAnalyze = () => ({ mode: "mixed", confidence: 0.5, signals: [] });
    const localService = createContextTriggerService({
      onSuggestion: onSuggestion as (s: import("./contextTriggerService.js").TriggerSuggestion) => void,
      debounceMs: 100,
      analyze: mixedAnalyze,
    });
    localService.onAppActivated("com.apple.Safari", []);
    vi.advanceTimersByTime(200);
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it("suggestion includes reason string from signals", () => {
    service.onAppActivated("com.microsoft.VSCode", []);
    vi.advanceTimersByTime(150);
    const suggestion = onSuggestion.mock.calls[0]?.[0] as { reason: string; confidence: number };
    expect(suggestion.reason).toBeTruthy();
    expect(suggestion.confidence).toBeGreaterThan(0);
  });
});
