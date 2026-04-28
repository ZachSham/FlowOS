import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceDictation } from "./hooks/useVoiceDictation";

type TrackingEventRecord = {
  timestamp: string;
  event: string;
  summary: string;
  payload: object;
};

type TrackingState = {
  isTracking: boolean;
  startedAt: string | null;
  eventCount: number;
  recentEvents: TrackingEventRecord[];
};

type FlowRunResult = {
  ok: boolean;
  summary: string;
  model: string | null;
  snapshotTimestamp: string | null;
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
  }>;
  toolResults: Array<{
    name: string;
    result: unknown;
  }>;
  errorCode?: "tracking-required";
};

type BootstrapState = {
  websocketPort: number;
  swiftHelper: {
    connected: boolean;
    transport: "stdio";
    command: string[];
  };
  tracking: TrackingState;
  flow: {
    status: "idle" | "running" | "completed" | "failed";
    lastRun: FlowRunResult | null;
  };
};

declare global {
  interface Window {
    flowos?: {
      getBootstrapState: () => Promise<BootstrapState>;
      startTracking: () => Promise<TrackingState>;
      enterFlowMode: (mode: "coding" | "research" | "auto") => Promise<FlowRunResult>;
      onTrayAction: (listener: (action: "toggle-mic") => void) => () => void;
      runVoiceCommand: (transcript: string) => Promise<FlowRunResult>;
      transcribeAudio: (audioData: Uint8Array) => Promise<string>;
      showWindow: () => Promise<void>;
      hideWindow: () => Promise<void>;
    };
  }
}

const fallbackBootstrap: BootstrapState = {
  websocketPort: 7331,
  swiftHelper: {
    connected: false,
    transport: "stdio",
    command: []
  },
  tracking: {
    isTracking: false,
    startedAt: null,
    eventCount: 0,
    recentEvents: []
  },
  flow: {
    status: "idle",
    lastRun: null
  }
};

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>(fallbackBootstrap);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!window.flowos) {
      setErrorMessage("Electron preload bridge is unavailable in this window.");
      return;
    }

    void window.flowos
      .getBootstrapState()
      .then((state) => {
        setBootstrap(state);
        setStatusMessage("Ready");
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      });
  }, []);

  const lastEvent = bootstrap.tracking.recentEvents[0] ?? null;

  async function handleStartTracking() {
    if (!window.flowos) {
      setErrorMessage("Electron preload bridge is unavailable in this window.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage("Starting tracking...");
    try {
      const tracking = await window.flowos.startTracking();
      setBootstrap((current) => ({
        ...current,
        tracking
      }));
      setStatusMessage("Tracking started.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatusMessage("Tracking failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleVoiceTranscript = useCallback(async (transcript: string) => {
    if (!window.flowos) {
      setErrorMessage("Electron preload bridge is unavailable.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(`Voice: "${transcript}" — processing...`);
    try {
      const result = await window.flowos.runVoiceCommand(transcript);
      setStatusMessage(result.ok ? "Voice command completed." : "Voice command failed.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setStatusMessage("Voice command failed.");
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const {
    isListening,
    lastTranscript,
    supported: voiceSupported,
    start: startListening,
    stop: stopListening
  } = useVoiceDictation(handleVoiceTranscript);

  const handleVoiceButtonClick = useCallback(() => {
    if (isSubmitting) {
      return;
    }

    if (voiceSupported) {
      if (isListening) {
        stopListening();
      } else {
        startListening();
      }
      return;
    }

    const typed = window.prompt("Speech recognition is unavailable here. Type a command:");
    const transcript = typed?.trim();
    if (!transcript) {
      return;
    }

    void handleVoiceTranscript(transcript);
  }, [
    handleVoiceTranscript,
    isListening,
    isSubmitting,
    startListening,
    stopListening,
    voiceSupported
  ]);

  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (isListening) {
      void window.flowos?.showWindow();
    } else {
      void window.flowos?.hideWindow();
    }
  }, [isListening]);

  useEffect(() => {
    if (!window.flowos?.onTrayAction) {
      return;
    }

    return window.flowos.onTrayAction((action) => {
      if (action === "toggle-mic") {
        handleVoiceButtonClick();
      }
    });
  }, [handleVoiceButtonClick]);

  async function handleEnterFlowMode(mode: "coding" | "research" | "auto") {
    if (!window.flowos) {
      setErrorMessage("Electron preload bridge is unavailable in this window.");
      return;
    }

    if (mode === "auto" && !bootstrap.tracking.isTracking) {
      const message =
        "Tracking required. Click Start Tracking, give it a moment to capture activity, then try again.";
      setErrorMessage(message);
      setStatusMessage("Tracking required.");
      window.alert(message);
      return;
    }

    const label = mode === "coding" ? "Coding" : mode === "research" ? "Research" : "Auto Flow";

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(`Entering ${label} mode...`);
    setBootstrap((current) => ({
      ...current,
      flow: {
        ...current.flow,
        status: "running"
      }
    }));

    try {
      const result = await window.flowos.enterFlowMode(mode);
      setBootstrap((current) => ({
        ...current,
        flow: {
          status: result.ok ? "completed" : "failed",
          lastRun: result
        }
      }));
      setStatusMessage(result.ok ? `${label} mode completed.` : `${label} mode failed.`);
      if (!result.ok) {
        setErrorMessage(result.summary);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setStatusMessage(`${label} mode failed.`);
      setBootstrap((current) => ({
        ...current,
        flow: {
          ...current.flow,
          status: "failed"
        }
      }));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-[#0c0c0e] text-white transition-all duration-200"
      style={{
        borderRadius: "14px",
        border: isListening ? "1px solid rgba(248,113,113,0.6)" : "1px solid rgba(255,255,255,0.08)",
        boxShadow: isListening ? "0 0 0 3px rgba(239,68,68,0.25), 0 0 20px rgba(239,68,68,0.15)" : "none"
      }}
    >
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${isListening ? "animate-pulse bg-red-400" : "bg-orange-400"}`} />
          <span className="text-[13px] font-semibold tracking-tight">FlowOS</span>
        </div>
        {isListening ? (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-red-400">Listening</span>
          </div>
        ) : null}
      </div>

      {/* ── Mic button ── */}
      <div className="shrink-0 px-3 pb-3">
        <button
          type="button"
          onClick={handleVoiceButtonClick}
          disabled={isSubmitting && !isListening}
          className={`flex w-full items-center gap-3 rounded-xl p-3.5 transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
            isListening
              ? "bg-red-500/15 ring-1 ring-red-500/30"
              : "bg-white/[0.05] ring-1 ring-white/[0.08] hover:bg-white/[0.08] hover:ring-white/[0.12]"
          }`}
        >
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isListening ? "bg-red-500/25" : "bg-orange-500/15"}`}>
            <svg className={`h-4 w-4 ${isListening ? "text-red-400" : "text-orange-400"}`} fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4zm-3 6a1 1 0 112 0 4 4 0 008 0 1 1 0 112 0 6 6 0 01-5 5.917V18h2a1 1 0 110 2H9a1 1 0 110-2h2v-2.083A6 6 0 014 10z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="text-[13px] font-medium leading-none">{isListening ? "Listening…" : "Voice Command"}</div>
            <div className="mt-1 text-[11px] leading-none text-white/35">⌘⇧K to toggle from anywhere</div>
          </div>
          {isListening && (
            <div className="flex shrink-0 items-center gap-0.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-0.5 animate-pulse rounded-full bg-red-400" style={{ height: `${8 + i * 4}px`, animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          )}
        </button>

        {lastTranscript ? (
          <div className="mt-2 rounded-lg bg-white/[0.04] px-3.5 py-2 ring-1 ring-white/[0.06]">
            <span className="text-[11px] text-white/40">Heard: </span>
            <span className="text-[11px] text-white/70">{lastTranscript}</span>
          </div>
        ) : null}
      </div>

      <div className="mx-3 h-px shrink-0 bg-white/[0.06]" />

      {/* ── Flow Modes ── */}
      <div className="shrink-0 px-3 py-3">
        <div className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">Flow Modes</div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => void handleEnterFlowMode("coding")}
            disabled={isSubmitting}
            className="rounded-xl bg-white/[0.05] px-3 py-2.5 text-left ring-1 ring-white/[0.08] transition-all hover:bg-white/[0.08] hover:ring-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div className="text-[13px] font-medium">Coding</div>
            <div className="mt-0.5 text-[11px] text-white/35">Dev layout</div>
          </button>
          <button
            type="button"
            onClick={() => void handleEnterFlowMode("research")}
            disabled={isSubmitting}
            className="rounded-xl bg-white/[0.05] px-3 py-2.5 text-left ring-1 ring-white/[0.08] transition-all hover:bg-white/[0.08] hover:ring-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div className="text-[13px] font-medium">Research</div>
            <div className="mt-0.5 text-[11px] text-white/35">Browser focus</div>
          </button>
        </div>
        <button
          type="button"
          onClick={() => void handleEnterFlowMode("auto")}
          disabled={isSubmitting}
          className="mt-1.5 flex w-full items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2.5 text-left ring-1 ring-white/[0.08] transition-all hover:bg-white/[0.08] hover:ring-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div>
            <div className="text-[13px] font-medium">Auto Flow</div>
            <div className="mt-0.5 text-[11px] text-white/35">{bootstrap.tracking.isTracking ? "Infer from activity" : "Requires tracking"}</div>
          </div>
          {bootstrap.tracking.isTracking && <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />}
        </button>
        <button
          type="button"
          onClick={() => void handleStartTracking()}
          disabled={isSubmitting || bootstrap.tracking.isTracking}
          className="mt-1.5 flex w-full items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2.5 text-left ring-1 ring-white/[0.08] transition-all hover:bg-white/[0.08] hover:ring-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div>
            <div className="text-[13px] font-medium">{bootstrap.tracking.isTracking ? "Tracking Active" : "Start Tracking"}</div>
            <div className="mt-0.5 text-[11px] text-white/35">
              {bootstrap.tracking.isTracking ? `${bootstrap.tracking.eventCount} events` : "Record activity context"}
            </div>
          </div>
          {bootstrap.tracking.isTracking && <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
        </button>
      </div>

      <div className="mx-3 h-px shrink-0 bg-white/[0.06]" />

      {/* ── Status ── */}
      <div className="shrink-0 px-3 py-3">
        <div className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">Status</div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[12px] text-white/40">Helper</span>
            <div className="flex items-center gap-1.5">
              <div className={`h-1.5 w-1.5 rounded-full ${bootstrap.swiftHelper.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className="text-[12px] text-white/60">{bootstrap.swiftHelper.connected ? "Connected" : "Starting"}</span>
            </div>
          </div>
          {lastEvent ? (
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[12px] text-white/40">Last event</span>
              <span className="max-w-[160px] truncate text-right text-[12px] text-white/55">{lastEvent.summary}</span>
            </div>
          ) : null}
        </div>
      </div>

      {isSubmitting ? (
        <div className="absolute bottom-3 right-3">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
        </div>
      ) : null}
    </div>
  );
}
