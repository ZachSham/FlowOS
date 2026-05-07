import { useState, useEffect } from "react";

interface License {
  key: string;
  email: string | null;
  plan: string;
  activated_at: string;
  expires_at: string | null;
}

interface Props {
  onLicenseChange: (license: License | null) => void;
}

export function LicensePanel({ onLicenseChange }: Props) {
  const [license, setLicense] = useState<License | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.flowos?.licenseGet().then((l) => {
      const typed = l as License | null;
      setLicense(typed);
      onLicenseChange(typed);
    }).catch(console.error);
  }, [onLicenseChange]);

  async function activate() {
    setLoading(true);
    setError(null);
    try {
      const l = await window.flowos?.licenseActivate(input);
      const typed = l as License;
      setLicense(typed);
      onLicenseChange(typed);
      setInput("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Activation failed");
    } finally {
      setLoading(false);
    }
  }

  async function deactivate() {
    await window.flowos?.licenseDeactivate();
    setLicense(null);
    onLicenseChange(null);
  }

  if (license) {
    return (
      <div className="px-3 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="text-[13px] font-semibold text-white">FlowOS Pro</span>
        </div>
        {license.email && <p className="text-[11px] text-white/40">{license.email}</p>}
        <p className="text-[11px] text-white/25">Analytics history and proactive triggers enabled.</p>
        <button
          onClick={() => void deactivate()}
          className="text-[11px] text-white/25 hover:text-red-400 underline"
        >
          Deactivate license
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-3 space-y-3">
      <div>
        <p className="text-[13px] font-semibold text-white mb-1">Unlock FlowOS Pro</p>
        <p className="text-[11px] text-white/35 leading-snug">
          Analytics history, proactive AI mode switching, and priority support.
        </p>
      </div>
      <input
        className="w-full bg-white/[0.06] ring-1 ring-white/[0.10] rounded-xl px-3 py-2 text-[12px] text-white placeholder:text-white/25 focus:outline-none focus:ring-indigo-500/60"
        placeholder="Enter license key"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void activate(); }}
      />
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <button
        disabled={loading || !input.trim()}
        onClick={() => void activate()}
        className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[12px] font-medium transition-colors"
      >
        {loading ? "Activating…" : "Activate"}
      </button>
    </div>
  );
}
