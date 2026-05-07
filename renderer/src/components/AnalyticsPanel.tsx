import { useEffect, useState } from "react";

interface DailyStat {
  date: string;
  total_focus_secs: number;
  coding_secs: number;
  research_secs: number;
  commands_run: number;
  sessions_count: number;
}

interface WeeklyRollup {
  totalFocusSecs: number;
  codingSecs: number;
  researchSecs: number;
  commandsRun: number;
  sessionsCount: number;
  dominantMode: "coding" | "research" | "balanced";
  avgDailyFocusMins: number;
}

function fmt(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function AnalyticsPanel() {
  const [data, setData] = useState<{ rollup: WeeklyRollup; days: DailyStat[] } | null>(null);

  useEffect(() => {
    window.flowos?.analyticsWeekly().then(setData).catch(console.error);
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-24 text-white/30 text-[12px]">
        Loading analytics…
      </div>
    );
  }

  const { rollup, days } = data;
  const maxSecs = Math.max(...days.map((d) => d.total_focus_secs), 1);

  return (
    <div className="px-3 py-3 space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] py-2.5 px-1">
          <p className="text-[15px] font-semibold text-white">{fmt(rollup.totalFocusSecs)}</p>
          <p className="text-[10px] text-white/30 mt-0.5">This week</p>
        </div>
        <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] py-2.5 px-1">
          <p className="text-[15px] font-semibold text-white">{rollup.avgDailyFocusMins}m</p>
          <p className="text-[10px] text-white/30 mt-0.5">Daily avg</p>
        </div>
        <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] py-2.5 px-1">
          <p className="text-[15px] font-semibold text-white">{rollup.commandsRun}</p>
          <p className="text-[10px] text-white/30 mt-0.5">Commands</p>
        </div>
      </div>

      {/* Mode breakdown */}
      {rollup.totalFocusSecs > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25 mb-1.5">Mode breakdown</p>
          <div className="flex h-1.5 rounded overflow-hidden bg-white/[0.08]">
            <div className="bg-blue-500/80" style={{ width: `${(rollup.codingSecs / rollup.totalFocusSecs) * 100}%` }} />
            <div className="bg-emerald-500/80" style={{ width: `${(rollup.researchSecs / rollup.totalFocusSecs) * 100}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-white/30 mt-1">
            <span className="text-blue-400/80">Coding {fmt(rollup.codingSecs)}</span>
            <span className="text-emerald-400/80">Research {fmt(rollup.researchSecs)}</span>
          </div>
        </div>
      )}

      {/* Daily bars */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25 mb-1.5">Last 7 days</p>
        <div className="flex items-end gap-1 h-10">
          {[...days].reverse().map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className="w-full rounded-sm bg-indigo-500/70 min-h-[2px]"
                style={{ height: `${Math.round((d.total_focus_secs / maxSecs) * 36)}px` }}
                title={`${d.date}: ${fmt(d.total_focus_secs)}`}
              />
              <span className="text-[8px] text-white/20">
                {new Date(d.date + "T12:00:00").toLocaleDateString("en", { weekday: "narrow" })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
