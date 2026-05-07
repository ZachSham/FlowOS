import Database from "better-sqlite3";

type DB = InstanceType<typeof Database>;

export interface License {
  key: string;
  email: string | null;
  plan: string;
  activated_at: string;
  expires_at: string | null;
}

export function getActiveLicense(db: DB): License | undefined {
  return db.prepare("SELECT * FROM licenses LIMIT 1").get() as License | undefined;
}

export function saveLicense(db: DB, license: License): void {
  db.prepare(`
    INSERT OR REPLACE INTO licenses (key, email, plan, activated_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(license.key, license.email, license.plan, license.activated_at, license.expires_at);
}

export function removeLicense(db: DB): void {
  db.prepare("DELETE FROM licenses").run();
}

export async function validateLicenseKey(
  key: string,
  opts: { firstActivation?: boolean } = {}
): Promise<{ valid: boolean; email?: string; plan?: string; expires_at?: string }> {
  try {
    const resp = await fetch("https://api.flowos.app/v1/license/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return { valid: false };
    return await resp.json() as { valid: boolean; email?: string; plan?: string; expires_at?: string };
  } catch {
    // Offline grace only for re-validation of an already-stored key, not first activation
    if (opts.firstActivation) return { valid: false };
    return { valid: true };
  }
}
