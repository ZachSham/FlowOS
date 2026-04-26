import { useEffect, useMemo, useState } from "react";

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
      enterFlowMode: () => Promise<FlowRunResult>;
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
  const toolCallCount = bootstrap.flow.lastRun?.toolCalls.length ?? 0;
  const secondaryCommand = useMemo(() => bootstrap.swiftHelper.command.join(" "), [bootstrap]);

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

  async function handleEnterFlowMode() {
    if (!window.flowos) {
      setErrorMessage("Electron preload bridge is unavailable in this window.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage("Entering flow mode...");
    setBootstrap((current) => ({
      ...current,
      flow: {
        ...current.flow,
        status: "running"
      }
    }));

    try {
      const result = await window.flowos.enterFlowMode();
      setBootstrap((current) => ({
        ...current,
        flow: {
          status: result.ok ? "completed" : "failed",
          lastRun: result
        }
      }));
      setStatusMessage(result.ok ? "Flow mode completed." : "Flow mode failed.");
      if (!result.ok) {
        setErrorMessage(result.summary);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setStatusMessage("Flow mode failed.");
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#162033_0%,#0b1220_48%,#020617_100%)] p-8 text-ink">
      <div className="mx-auto w-full max-w-2xl rounded-[28px] border border-white/10 bg-slate-950/55 p-8 shadow-[0_30px_100px_rgba(2,6,23,0.55)] backdrop-blur">
        <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/75">FlowOS</div>
        <h1 className="mt-3 text-3xl font-semibold text-white">Start Tracking, Then Enter Flow</h1>
        <p className="mt-3 text-sm leading-6 text-white/65">
          This window only does two things: track app-level activity and run the LLM-driven develop
          mode layout against a fresh system snapshot.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void handleStartTracking()}
            disabled={isSubmitting || bootstrap.tracking.isTracking}
            className="rounded-2xl border border-orange-300/40 bg-orange-300/15 px-4 py-3 text-sm font-medium text-orange-100 transition hover:bg-orange-300/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bootstrap.tracking.isTracking ? "Tracking Active" : "Start Tracking"}
          </button>
          <button
            type="button"
            onClick={() => void handleEnterFlowMode()}
            disabled={isSubmitting}
            className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Enter Flow Mode
          </button>
        </div>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
          <dl className="space-y-3 text-sm text-white/75">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-white/45">Status</dt>
              <dd>{statusMessage}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-white/45">Swift helper</dt>
              <dd>{bootstrap.swiftHelper.connected ? "connected" : "starting"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-white/45">Tracking</dt>
              <dd>{bootstrap.tracking.isTracking ? "active" : "idle"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-white/45">Tracked events</dt>
              <dd>{bootstrap.tracking.eventCount}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-white/45">Flow status</dt>
              <dd>{bootstrap.flow.status}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-white/45">Last tool calls</dt>
              <dd>{toolCallCount}</dd>
            </div>
          </dl>
        </section>

        {errorMessage ? (
          <section className="mt-4 rounded-3xl border border-red-400/25 bg-red-950/30 p-5">
            <div className="text-[11px] uppercase tracking-[0.3em] text-red-200/75">Error</div>
            <p className="mt-3 text-sm leading-6 text-red-50/85">{errorMessage}</p>
          </section>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">Latest Event</div>
            {lastEvent ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-sm font-medium text-white">{lastEvent.summary}</div>
                <div className="mt-2 text-xs text-white/45">{lastEvent.timestamp}</div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-white/55">No tracked events yet.</p>
            )}
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">Last Flow Run</div>
            {bootstrap.flow.lastRun ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm leading-6 text-white/75">
                  {bootstrap.flow.lastRun.summary}
                </div>
                <div className="text-xs text-white/45">
                  Snapshot: {bootstrap.flow.lastRun.snapshotTimestamp ?? "none"}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-white/55">No flow mode run yet.</p>
            )}
          </section>
        </div>

        <section className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">Bridge Command</div>
          <p className="mt-4 break-all rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs leading-6 text-white/60">
            {secondaryCommand || "Waiting for helper command..."}
          </p>
        </section>
      </div>
    </div>
  );
}
