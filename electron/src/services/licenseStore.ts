import Database from "better-sqlite3";
import { createHmac, timingSafeEqual } from "node:crypto";

type DB = InstanceType<typeof Database>;

// Key format: FLOWOS-{PLAN4}-{RAND8}-{RAND8}-{CHECK8}
// Example:    FLOWOS-PRO1-A1B2C3D4-E5F6A7B8-3F9C1D2E
//
// CHECK8 = first 8 hex chars of HMAC-SHA256(secret, "PLAN4-RAND8-RAND8")
// Plan is encoded in PLAN4: PRO1 = pro, TEAM = team, LTME = lifetime

const SECRET = process.env["FLOWOS_LICENSE_SECRET"] ?? "flowos-dev-secret-2026";

const PLAN_MAP: Record<string, string> = {
  PRO1: "pro",
  TEAM: "team",
  LTME: "lifetime",
  DEMO: "pro",
};

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

// Validates a FLOWOS license key locally using HMAC — no server needed.
// Returns the plan if valid, null if invalid.
export function validateKeyLocally(key: string): { valid: boolean; plan: string } {
  const normalized = key.trim().toUpperCase();
  const parts = normalized.split("-");

  // Format: FLOWOS-{PLAN4}-{RAND8}-{RAND8}-{CHECK8} → 5 segments
  if (parts.length !== 5 || parts[0] !== "FLOWOS") {
    return { valid: false, plan: "" };
  }

  const [, planCode, rand1, rand2, check] = parts as [string, string, string, string, string];

  if (!PLAN_MAP[planCode]) {
    return { valid: false, plan: "" };
  }

  // Recompute expected checksum
  const payload = `${planCode}-${rand1}-${rand2}`;
  const expected = computeCheck(payload);

  // Use timing-safe comparison
  try {
    const checkBuf = Buffer.from(check!, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (checkBuf.length !== expectedBuf.length || !timingSafeEqual(checkBuf, expectedBuf)) {
      return { valid: false, plan: "" };
    }
  } catch {
    return { valid: false, plan: "" };
  }

  return { valid: true, plan: PLAN_MAP[planCode]! };
}

export async function validateLicenseKey(
  key: string,
  opts: { firstActivation?: boolean } = {}
): Promise<{ valid: boolean; email?: string; plan?: string; expires_at?: string }> {
  // Always check local HMAC first — instant and works offline
  const local = validateKeyLocally(key);
  if (!local.valid) {
    return { valid: false };
  }

  // Local check passed — try remote for revocation check (optional, best-effort)
  try {
    const resp = await fetch("https://api.flowos.app/v1/license/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      const data = await resp.json() as { valid: boolean; email?: string; plan?: string; expires_at?: string };
      // Server can revoke a locally-valid key
      return data;
    }
  } catch {
    // Remote unreachable — local validation is sufficient
    if (opts.firstActivation) {
      // First activation: allow if local check passed (server just isn't live yet)
      return { valid: true, plan: local.plan };
    }
  }

  // Remote returned non-OK or we're in re-validation path — trust local result
  return { valid: true, plan: local.plan };
}

// Generates a valid license key for a given plan tier.
// planCode must be one of: PRO1, TEAM, LTME, DEMO
export function generateLicenseKey(planCode: keyof typeof PLAN_MAP = "PRO1"): string {
  const rand1 = randomHex(4).toUpperCase();
  const rand2 = randomHex(4).toUpperCase();
  const payload = `${planCode}-${rand1}-${rand2}`;
  const check = computeCheck(payload);
  return `FLOWOS-${payload}-${check.toUpperCase()}`;
}

function computeCheck(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 8);
}

function randomHex(bytes: number): string {
  return Array.from(
    { length: bytes },
    () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("").toUpperCase();
}
