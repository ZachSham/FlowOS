interface Props {
  score: number;
  onDismiss: () => void;
  onEnterFocus: () => void;
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Deep focus";
  if (score >= 60) return "Moderate focus";
  if (score >= 40) return "Distracted";
  return "Fragmented";
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function scoreBarColor(score: number): string {
  if (score >= 70) return "bg-emerald-500/70";
  if (score >= 40) return "bg-amber-500/70";
  return "bg-red-500/70";
}

export function FocusScoreBadge({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06]">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/30">Focus</span>
          <span className={`text-[12px] font-semibold ${scoreColor(score)}`}>{score}</span>
        </div>
        <div className="h-1 rounded-full bg-white/[0.08] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${scoreBarColor(score)}`}
            style={{ width: `${score}%` }}
          />
        </div>
        <p className={`text-[10px] mt-0.5 ${scoreColor(score)}`}>{scoreLabel(score)}</p>
      </div>
    </div>
  );
}

export function FocusAlertToast({ score, onDismiss, onEnterFocus }: Props) {
  return (
    <div className="mx-3 mt-2 p-3 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/25">
      <p className="text-[12px] font-semibold text-white mb-0.5">
        Focus score: {score} — you're fragmented
      </p>
      <p className="text-[11px] text-white/40 mb-2.5 leading-snug">
        You've switched apps frequently. Lock in?
      </p>
      <div className="flex gap-1.5">
        <button
          onClick={onEnterFocus}
          className="flex-1 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-medium transition-colors"
        >
          Enter Focus Mode
        </button>
        <button
          onClick={onDismiss}
          className="flex-1 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] text-white/50 text-[11px] transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
