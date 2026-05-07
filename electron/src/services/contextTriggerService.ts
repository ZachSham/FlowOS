import { analyzeWorkStyle } from "./workStyleAnalyzer.js";
import type { TrackingEventRecord } from "./trackingSession.js";

export interface TriggerSuggestion {
  kind: "mode_suggestion";
  suggestedMode: "coding" | "research";
  reason: string;
  confidence: number;
}

type AnalyzeResult = { mode: string; confidence: number; signals: string[] };

interface ContextTriggerOptions {
  onSuggestion: (suggestion: TriggerSuggestion) => void;
  debounceMs?: number;
  // Override analysis function for testing
  analyze?: (events: TrackingEventRecord[], bundleId: string) => AnalyzeResult;
}

export interface ContextTriggerService {
  onAppActivated(bundleId: string, recentEvents: TrackingEventRecord[]): void;
  setActiveMode(mode: string | null): void;
  dispose(): void;
}

export function createContextTriggerService(options: ContextTriggerOptions): ContextTriggerService {
  const debounceMs = options.debounceMs ?? 8000;
  const doAnalyze = options.analyze ?? defaultAnalyze;
  let debounceTimer: NodeJS.Timeout | null = null;
  let activeMode: string | null = null;
  let pendingEvents: TrackingEventRecord[] = [];
  let pendingBundleId = "";

  function onAppActivated(bundleId: string, recentEvents: TrackingEventRecord[]): void {
    pendingEvents = recentEvents;
    pendingBundleId = bundleId;

    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      evaluate();
    }, debounceMs);
  }

  function evaluate(): void {
    const analysis = doAnalyze(pendingEvents, pendingBundleId);

    if (analysis.mode === "unclear" || analysis.mode === "mixed" || analysis.confidence < 0.35) {
      return;
    }

    const suggestedMode: "coding" | "research" = analysis.mode === "coding" ? "coding" : "research";

    // Don't suggest if already in the detected mode
    if (activeMode === suggestedMode) {
      return;
    }

    options.onSuggestion({
      kind: "mode_suggestion",
      suggestedMode,
      reason: analysis.signals.slice(0, 2).join(", "),
      confidence: analysis.confidence,
    });
  }

  function setActiveMode(mode: string | null): void {
    activeMode = mode;
  }

  function dispose(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  return { onAppActivated, setActiveMode, dispose };
}

function defaultAnalyze(events: TrackingEventRecord[], bundleId: string): AnalyzeResult {
  const analysis = analyzeWorkStyle(
    events,
    bundleId ? [{ bundleId, name: bundleId, pid: 0, isHidden: false, isActive: true }] : []
  );
  return { mode: analysis.mode, confidence: analysis.confidence, signals: analysis.signals };
}
