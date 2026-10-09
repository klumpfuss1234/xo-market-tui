import { describe, expect, it } from "vitest";
import { amountsFor, formatFixed6, parseFixed6, parsePriceTicks } from "../src/trading/units.js";

describe("fixed-point units", () => {
  it("parses six decimals without floating point", () => {
    expect(parseFixed6("12.345678", "value")).toBe(12_345_678n);
    expect(formatFixed6(12_345_678n)).toBe("12.345678");
  });
  it("enforces XO price ticks", () => {
    expect(parsePriceTicks("0.382")).toBe(382_000n);
    expect(() => parsePriceTicks("0.3825")).toThrow(/tick/);
  });
  it("builds BUY and SELL maker amounts", () => {
    expect(amountsFor("BUY", "0.382", "10")).toEqual({ makerAmount: 3_820_000n, takerAmount: 10_000_000n, notional: 3_820_000n });
    expect(amountsFor("SELL", "0.382", "10")).toEqual({ makerAmount: 10_000_000n, takerAmount: 3_820_000n, notional: 3_820_000n });
  });
});
