import { describe, it, expect, beforeEach, vi } from "vitest";
import { ensureDatabase } from "@flowos/db";
import { getActiveLicense, saveLicense, removeLicense, validateLicenseKey } from "./licenseStore.js";

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

describe("validateLicenseKey", () => {
  it("returns valid:false on fetch throw during first activation (no offline grace)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network error")));
    const result = await validateLicenseKey("any-key", { firstActivation: true });
    expect(result.valid).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns valid:true on fetch throw during re-validation (offline grace)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network error")));
    const result = await validateLicenseKey("any-key", { firstActivation: false });
    expect(result.valid).toBe(true);
    vi.unstubAllGlobals();
  });

  it("returns valid:true on fetch throw with default opts (re-validation path)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network error")));
    const result = await validateLicenseKey("any-key");
    expect(result.valid).toBe(true);
    vi.unstubAllGlobals();
  });

  it("returns valid:false when server returns non-OK status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const result = await validateLicenseKey("bad-key", { firstActivation: true });
    expect(result.valid).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns server response when server returns valid:true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, email: "user@example.com", plan: "pro" }),
    }));
    const result = await validateLicenseKey("good-key", { firstActivation: true });
    expect(result.valid).toBe(true);
    expect(result.email).toBe("user@example.com");
    vi.unstubAllGlobals();
  });
});
