import { describe, expect, it } from "vitest";
import { canonicalTarget, signHmac } from "../src/api/auth.js";

describe("HMAC", () => {
  it("supports documented and live-compatible canonical targets", () => {
    const url = new URL("https://orderbooks.xo.market/orders?limit=10");
    expect(canonicalTarget(url, "path-only")).toBe("/orders");
    expect(canonicalTarget(url, "path-with-query")).toBe("/orders?limit=10");
  });
  it("is deterministic", () => {
    const secret = Buffer.from("test secret").toString("base64");
    expect(signHmac(secret, "123", "GET", "/orders")).toBe(signHmac(secret, "123", "GET", "/orders"));
  });
});
