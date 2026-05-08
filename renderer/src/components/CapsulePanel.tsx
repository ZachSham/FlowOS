import { useEffect, useState } from "react";

interface Capsule {
  id: string;
  name: string;
  created_at: string;
  vscode: { activeFile: string | null; openTabs: string[] } | null;
  chrome: { url: string; title: string }[];
  windows: { appName: string }[];
}

interface Props {
  onStatus: (msg: string) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

function fileName(path: string | null): string {
  if (!path) return "no file";
  return path.split("/").pop() ?? path;
}

export function CapsulePanel({ onStatus }: Props) {
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    void window.flowos?.capsuleList().then((c) => setCapsules(c as Capsule[])).catch(console.error);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const name = saveName.trim() || `Capsule ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      const capsule = await window.flowos?.capsuleSave(name) as Capsule;
      setCapsules((prev) => [capsule, ...prev]);
      setSaveName("");
      onStatus(`Saved "${name}"`);
    } catch (e) {
      onStatus(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(id: string, name: string) {
    setRestoringId(id);
    try {
      const result = await window.flowos?.capsuleRestore(id) as { ok: boolean; results: string[] };
      onStatus(result.results.join(" · ") || `Restored "${name}"`);
    } catch (e) {
      onStatus(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoringId(null);
    }
  }

  async function handleDelete(id: string) {
    await window.flowos?.capsuleDelete(id);
    setCapsules((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="px-3 py-3 space-y-3">
      {/* Save row */}
      <div className="flex gap-1.5">
        <input
          className="flex-1 bg-white/[0.06] ring-1 ring-white/[0.10] rounded-xl px-3 py-1.5 text-[12px] text-white placeholder:text-white/25 focus:outline-none focus:ring-indigo-500/60"
          placeholder="Name this capsule…"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
        />
        <button
          disabled={saving}
          onClick={() => void handleSave()}
          className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-semibold transition-colors whitespace-nowrap"
        >
          {saving ? "…" : "Save"}
        </button>
      </div>

      {/* Capsule list */}
      {capsules.length === 0 ? (
        <p className="text-[11px] text-white/25 text-center py-4">No capsules saved yet.</p>
      ) : (
        <div className="space-y-1.5">
          {capsules.map((c) => (
            <div key={c.id} className="rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-white truncate">{c.name}</p>
                  <p className="text-[10px] text-white/30 mt-0.5">{timeAgo(c.created_at)}</p>
                  {/* Capsule preview */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {c.vscode?.activeFile && (
                      <span className="text-[9px] bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded-md">
                        {fileName(c.vscode.activeFile)}
                      </span>
                    )}
                    {c.chrome.length > 0 && (
                      <span className="text-[9px] bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 rounded-md">
                        {c.chrome.length} tab{c.chrome.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {c.windows.length > 0 && (
                      <span className="text-[9px] bg-purple-500/15 text-purple-300 px-1.5 py-0.5 rounded-md">
                        {c.windows.length} window{c.windows.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    disabled={restoringId === c.id}
                    onClick={() => void handleRestore(c.id, c.name)}
                    className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
                  >
                    {restoringId === c.id ? "…" : "Resume"}
                  </button>
                  <button
                    onClick={() => void handleDelete(c.id)}
                    className="text-[10px] text-white/20 hover:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
