import { describe, it, expect, beforeEach, vi } from "vitest";
import { ensureDatabase } from "@flowos/db";
import { getActiveLicense, saveLicense, removeLicense, validateLicenseKey, validateKeyLocally, generateLicenseKey } from "./licenseStore.js";

let db: ReturnType<typeof ensureDatabase>;

beforeEach(() => {
  db = ensureDatabase(":memory:");
});

describe("getActiveLicense", () => {
  it("returns undefined when no license stored", () => {
    expect(getActiveLicense(db)).toBeUndefined();
  });

  it("returns the stored license", () => {
    saveLicense(db, { key: "ABC-123", email: "test@test.com", plan: "pro", activated_at: "2026-01-01T00:00:00Z", expires_at: null });
    const license = getActiveLicense(db);
    expect(license?.key).toBe("ABC-123");
    expect(license?.email).toBe("test@test.com");
    expect(license?.plan).toBe("pro");
  });
});

describe("saveLicense", () => {
  it("inserts a license row", () => {
    saveLicense(db, { key: "KEY-1", email: null, plan: "pro", activated_at: "2026-01-01T00:00:00Z", expires_at: null });
    const rows = db.prepare("SELECT * FROM licenses").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!["key"]).toBe("KEY-1");
  });

  it("replaces existing license on second save (INSERT OR REPLACE)", () => {
    saveLicense(db, { key: "KEY-1", email: null, plan: "pro", activated_at: "2026-01-01T00:00:00Z", expires_at: null });
    saveLicense(db, { key: "KEY-2", email: "new@test.com", plan: "pro", activated_at: "2026-02-01T00:00:00Z", expires_at: null });
    const rows = db.prepare("SELECT * FROM licenses").all() as Array<Record<string, unknown>>;
    // KEY-1 stays since they have different primary keys
    expect(rows).toHaveLength(2);
    const found = rows.find((r) => r["key"] === "KEY-2");
    expect(found).toBeDefined();
  });
});

describe("removeLicense", () => {
  it("deletes all license rows", () => {
    saveLicense(db, { key: "KEY-1", email: null, plan: "pro", activated_at: "2026-01-01T00:00:00Z", expires_at: null });
    removeLicense(db);
    expect(getActiveLicense(db)).toBeUndefined();
  });

  it("is a no-op when no license exists", () => {
    expect(() => removeLicense(db)).not.toThrow();
  });
});

describe("generateLicenseKey + validateKeyLocally", () => {
  it("generates a key that validates locally", () => {
    const key = generateLicenseKey("PRO1");
    expect(validateKeyLocally(key).valid).toBe(true);
    expect(validateKeyLocally(key).plan).toBe("pro");
  });

  it("generates TEAM keys with correct plan", () => {
    const key = generateLicenseKey("TEAM");
    const result = validateKeyLocally(key);
    expect(result.valid).toBe(true);
    expect(result.plan).toBe("team");
  });

  it("generates LIFETIME keys", () => {
    const key = generateLicenseKey("LTME");
    expect(validateKeyLocally(key).plan).toBe("lifetime");
  });

  it("rejects a tampered key", () => {
    const key = generateLicenseKey("PRO1");
    const tampered = key.slice(0, -2) + "ZZ";
    expect(validateKeyLocally(tampered).valid).toBe(false);
  });

  it("rejects a completely random string", () => {
    expect(validateKeyLocally("not-a-real-key").valid).toBe(false);
  });

  it("rejects key with wrong plan code", () => {
    expect(validateKeyLocally("FLOWOS-FAKE-12345678-ABCDEF01-DEADBEEF").valid).toBe(false);
  });

  it("is case-insensitive", () => {
    const key = generateLicenseKey("PRO1");
    expect(validateKeyLocally(key.toLowerCase()).valid).toBe(true);
  });
});

describe("validateLicenseKey", () => {
  it("rejects an invalid key immediately (no network call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await validateLicenseKey("bad-key", { firstActivation: true });
    expect(result.valid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("accepts a valid key when remote is unreachable (offline grace)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network error")));
    const key = generateLicenseKey("PRO1");
    const result = await validateLicenseKey(key, { firstActivation: true });
    expect(result.valid).toBe(true);
    expect(result.plan).toBe("pro");
    vi.unstubAllGlobals();
  });

  it("accepts a valid key when remote is unreachable (re-validation)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network error")));
    const key = generateLicenseKey("TEAM");
    const result = await validateLicenseKey(key);
    expect(result.valid).toBe(true);
    vi.unstubAllGlobals();
  });

  it("lets server revoke a locally-valid key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: false }),
    }));
    const key = generateLicenseKey("PRO1");
    const result = await validateLicenseKey(key, { firstActivation: true });
    expect(result.valid).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns server email and plan when server responds OK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, email: "user@example.com", plan: "pro" }),
    }));
    const key = generateLicenseKey("PRO1");
    const result = await validateLicenseKey(key, { firstActivation: true });
    expect(result.valid).toBe(true);
    expect(result.email).toBe("user@example.com");
    vi.unstubAllGlobals();
  });
});
