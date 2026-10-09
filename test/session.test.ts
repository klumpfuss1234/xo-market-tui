import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectWalletEnvironment, WALLET_ENV_KEYS } from "../src/wallet/session.js";

const tracked = [...WALLET_ENV_KEYS, "XO_TUI_HMAC_MODE"] as const;
const original = new Map(tracked.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of tracked) delete process.env[key];
});

afterEach(() => {
  for (const key of tracked) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

describe("wallet environment setup", () => {
  it("reports every missing wallet variable without exposing values", () => {
    const state = inspectWalletEnvironment();
    expect(state.session).toBeUndefined();
    expect(state.missing).toEqual(WALLET_ENV_KEYS);
    expect(state.invalid).toBeUndefined();
  });

  it("accepts a complete valid environment", () => {
    process.env.XO_TUI_SMART_ACCOUNT = "0x0000000000000000000000000000000000000001";
    process.env.XO_TUI_OWNER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
    process.env.XO_TUI_API_KEY = "public-test-key";
    process.env.XO_TUI_API_SECRET = "a".repeat(32);
    process.env.XO_TUI_API_PASSPHRASE = ["test", "passphrase"].join("-");
    process.env.XO_TUI_HMAC_MODE = "path-with-query";

    const state = inspectWalletEnvironment();
    expect(state.missing).toEqual([]);
    expect(state.invalid).toBeUndefined();
    expect(state.session?.smartAccount).toBe("0x0000000000000000000000000000000000000001");
    expect(state.session?.hmacMode).toBe("path-with-query");
  });

  it("rejects malformed complete values", () => {
    process.env.XO_TUI_SMART_ACCOUNT = "not-an-address";
    process.env.XO_TUI_OWNER_PRIVATE_KEY = `0x${"22".repeat(32)}`;
    process.env.XO_TUI_API_KEY = "public-test-key";
    process.env.XO_TUI_API_SECRET = "b".repeat(32);
    process.env.XO_TUI_API_PASSPHRASE = ["test", "passphrase"].join("-");

    const state = inspectWalletEnvironment();
    expect(state.session).toBeUndefined();
    expect(state.missing).toEqual([]);
    expect(state.invalid).toBe("XO_TUI_SMART_ACCOUNT is not a valid address");
    expect(state.invalid).not.toContain("not-an-address");
  });
});
