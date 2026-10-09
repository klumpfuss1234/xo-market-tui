import type { OrderBook, OrderDraft, Position } from "../types.js";
import { amountsFor, parseFixed6 } from "./units.js";

export interface DraftCheck { draft: OrderDraft; errors: string[]; warnings: string[]; notional: bigint }

export function validateDraft(draft: OrderDraft, book?: OrderBook, positions: Position[] = []): DraftCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  let notional = 0n;
  try { notional = amountsFor(draft.side, draft.price, draft.shares).notional; } catch (error) { errors.push((error as Error).message); }
  if (draft.postOnly && !["GTC", "GTD"].includes(draft.timeInForce)) errors.push("post-only requires GTC or GTD");
  if (draft.timeInForce === "GTD" && !draft.expiration) errors.push("GTD requires expiration");
  if (book) {
    const minSize = Number(book.min_order_size || 0);
    if (minSize && Number(draft.shares) < minSize) errors.push(`minimum size is ${book.min_order_size} shares`);
    const bestBid = book.bids[0] ? Number(book.bids[0].price) : undefined;
    const bestAsk = book.asks[0] ? Number(book.asks[0].price) : undefined;
    if (draft.postOnly && draft.side === "BUY" && bestAsk !== undefined && Number(draft.price) >= bestAsk) errors.push(`post-only BUY would cross best ask ${bestAsk}`);
    if (draft.postOnly && draft.side === "SELL" && bestBid !== undefined && Number(draft.price) <= bestBid) errors.push(`post-only SELL would cross best bid ${bestBid}`);
    if (!draft.postOnly) warnings.push("may take liquidity and incur taker fees");
  } else warnings.push("book unavailable; submission should be aborted");
  if (draft.side === "SELL") {
    const position = positions.find((row) => row.token_id === draft.tokenId);
    if (position) {
      const free = BigInt(position.balance) - BigInt(position.reserved);
      try { if (parseFixed6(draft.shares, "shares") > free) errors.push("SELL exceeds free token balance"); } catch { /* amount error already recorded */ }
    } else if (positions.length) errors.push("no position found for SELL token");
  }
  return { draft, errors, warnings, notional };
}

export function buildLadder(input: {
  base: Omit<OrderDraft, "id" | "price">;
  startPrice: number;
  endPrice: number;
  levels: number;
}): OrderDraft[] {
  if (!Number.isInteger(input.levels) || input.levels < 1 || input.levels > 100) throw new Error("levels must be 1–100");
  const step = input.levels === 1 ? 0 : (input.endPrice - input.startPrice) / (input.levels - 1);
  return Array.from({ length: input.levels }, (_, index) => ({
    ...input.base,
    id: `${Date.now()}-${index}`,
    price: (Math.round((input.startPrice + step * index) * 1000) / 1000).toFixed(3)
  }));
}
