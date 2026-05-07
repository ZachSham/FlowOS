interface Props {
  suggestedMode: string;
  reason: string;
  onAccept: () => void;
  onDismiss: () => void;
}

const MODE_LABELS: Record<string, string> = {
  coding: "Coding Mode",
  research: "Research Mode",
  auto: "Auto Mode",
};

export function TriggerToast({ suggestedMode, reason, onAccept, onDismiss }: Props) {
  return (
    <div className="mx-3 mt-2 p-3 rounded-xl bg-indigo-500/10 ring-1 ring-indigo-500/25">
      <p className="text-[12px] font-semibold text-white mb-0.5">
        Switch to {MODE_LABELS[suggestedMode] ?? suggestedMode}?
      </p>
      <p className="text-[11px] text-white/40 mb-2.5 leading-snug">
        {reason}
      </p>
      <div className="flex gap-1.5">
        <button
          onClick={onAccept}
          className="flex-1 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors"
        >
          Switch
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
