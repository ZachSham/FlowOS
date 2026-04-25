import { useEffect, useState } from "react";
import type { Suggestion, TaskState } from "@flowos/shared";
import { demoSuggestions, demoTaskState } from "@flowos/shared";
import { SuggestionList } from "./components/SuggestionList";

type BootstrapState = {
  taskState: TaskState;
  suggestions: Suggestion[];
  websocketPort: number;
  swiftHelper: { connected: boolean; socketPath: string };
};

type LiveState = {
  taskState?: TaskState;
  suggestions?: Suggestion[];
  reasoning?: string;
  hasError: boolean;
};

declare global {
  interface Window {
    flowos?: {
      getBootstrapState: () => Promise<BootstrapState>;
      onStateUpdate: (callback: (state: LiveState) => void) => () => void;
      onStateLoading: (callback: () => void) => () => void;
    };
  }
}

function useViewMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") === "sidebar" ? "sidebar" : "main";
}

export function App() {
  const viewMode = useViewMode();
  const [taskState, setTaskState] = useState<TaskState>(demoTaskState);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(demoSuggestions);
  const [websocketPort, setWebsocketPort] = useState(7331);
  const [reasoning, setReasoning] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!window.flowos) return;

    void window.flowos.getBootstrapState().then((state) => {
      setTaskState(state.taskState);
      setSuggestions(state.suggestions);
      setWebsocketPort(state.websocketPort);
    });

    const cleanupLoading = window.flowos.onStateLoading(() => {
      setIsLoading(true);
      setHasError(false);
    });

    const cleanupUpdate = window.flowos.onStateUpdate((state) => {
      setIsLoading(false);
      if (state.hasError) {
        setHasError(true);
        return;
      }
      setHasError(false);
      if (state.taskState) setTaskState(state.taskState);
      if (state.suggestions) setSuggestions(state.suggestions);
      if (state.reasoning !== undefined) setReasoning(state.reasoning);
    });

    return () => {
      cleanupLoading();
      cleanupUpdate();
    };
  }, []);

  const fileSuggestions = suggestions.filter((item) => item.kind === "file");
  const commandSuggestions = suggestions.filter((item) => item.kind === "command");
  const tabSuggestions = suggestions.filter((item) => item.kind === "tab");

  if (viewMode === "sidebar") {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b_0%,#0f172a_48%,#020617_100%)] px-4 py-5 text-ink">
        <div className={`mb-5 rounded-3xl border border-orange-400/20 bg-black/20 p-4 transition-opacity ${isLoading ? "opacity-60" : "opacity-100"}`}>
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-[0.24em] text-orange-300/75">Flow State</div>
            <div className="flex items-center gap-2">
              {isLoading && <span className="text-[10px] text-white/40 animate-pulse">thinking…</span>}
              {hasError && <span className="text-[10px] text-orange-400/80">⚠ offline</span>}
            </div>
          </div>
          <h1 className="mt-2 text-xl font-semibold text-white">{taskState.title}</h1>
          <p className="mt-2 text-sm text-white/65">{taskState.substate}</p>
          <div className="mt-4 flex items-center justify-between text-xs text-white/45">
            <span>{taskState.mode}</span>
            <span>WS {websocketPort}</span>
          </div>
        </div>

        {reasoning && (
          <div className="mb-5 rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-white/45">Why FlowOS thinks this</div>
            <p className="text-sm leading-6 text-white/60">{reasoning}</p>
          </div>
        )}

        <div className="space-y-4">
          <SuggestionList heading="Suggested Files" items={fileSuggestions} />
          <SuggestionList heading="Suggested Commands" items={commandSuggestions} />
          <SuggestionList heading="Suggested Tabs" items={tabSuggestions} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#020617_0%,#0f172a_40%,#1f2937_100%)] p-8 text-ink">
      <div className="w-full max-w-5xl rounded-[32px] border border-white/10 bg-white/5 p-8 backdrop-blur">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/75">
              FlowOS
            </div>
            <h1 className="mt-3 text-4xl font-semibold text-white">{taskState.title}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/65">
              {taskState.substate}
            </p>
            {reasoning && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 max-w-2xl">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/40 mb-2">Why FlowOS thinks this</div>
                <p className="text-sm leading-6 text-white/60">{reasoning}</p>
              </div>
            )}
          </div>

          <div className={`rounded-3xl border border-white/10 bg-slate-950/60 px-5 py-4 transition-opacity ${isLoading ? "opacity-60" : "opacity-100"}`}>
            <div className="flex items-center justify-between gap-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">Current Task</div>
              <div className="flex items-center gap-2">
                {isLoading && <span className="text-[10px] text-white/40 animate-pulse">thinking…</span>}
                {hasError && <span className="text-[10px] text-orange-400/80">⚠ offline</span>}
              </div>
            </div>
            <div className="mt-2 text-lg font-medium text-white">{taskState.title}</div>
            <div className="mt-2 text-sm text-white/55">{taskState.substate}</div>
            <div className="mt-3 text-xs text-white/30">{taskState.mode} · {Math.round(taskState.confidence * 100)}% confidence</div>
          </div>
        </div>
      </div>
    </div>
  );
}
