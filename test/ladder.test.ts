import { describe, expect, it } from "vitest";
import { buildLadder, validateDraft } from "../src/trading/validation.js";
import type { OrderBook, OrderDraft } from "../src/types.js";

const base: Omit<OrderDraft, "id" | "price"> = {
  conditionId: "condition", marketTitle: "Market", tokenId: "123", outcome: "Yes",
  side: "SELL", shares: "10", timeInForce: "GTC", postOnly: true
};

const book: OrderBook = {
  market: "condition", asset_id: "123", timestamp: "1", hash: "hash",
  bids: [{ price: "0.380", size: "100" }], asks: [{ price: "0.390", size: "100" }],
  min_order_size: "1", tick_size: "0.001", last_trade_price: "0.385"
};

describe("ladder", () => {
  it("creates inclusive tick-aligned levels", () => {
    expect(buildLadder({ base, startPrice: 0.391, endPrice: 0.395, levels: 3 }).map((row) => row.price)).toEqual(["0.391", "0.393", "0.395"]);
  });
  it("blocks a post-only sell that crosses", () => {
    const [draft] = buildLadder({ base, startPrice: 0.379, endPrice: 0.379, levels: 1 });
    expect(validateDraft(draft!, book).errors.join(" ")).toMatch(/cross/);
  });
});
