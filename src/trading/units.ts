import type { Side } from "../types.js";

export const MICRO = 1_000_000n;

export function parseFixed6(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(trimmed)) throw new Error(`${label} must be a positive decimal with at most 6 places`);
  const [whole = "0", fraction = ""] = trimmed.split(".");
  return BigInt(whole) * MICRO + BigInt(fraction.padEnd(6, "0"));
}

export function parsePriceTicks(value: string): bigint {
  const micro = parseFixed6(value, "price");
  if (micro < 1_000n || micro > 999_000n) throw new Error("price must be between 0.001 and 0.999");
  if (micro % 1_000n !== 0n) throw new Error("price must align to the 0.001 tick");
  return micro;
}

export function formatFixed6(value: bigint): string {
  const whole = value / MICRO;
  const fraction = (value % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function amountsFor(side: Side, price: string, shares: string): { makerAmount: bigint; takerAmount: bigint; notional: bigint } {
  const priceMicro = parsePriceTicks(price);
  const shareMicro = parseFixed6(shares, "shares");
  if (shareMicro < MICRO) throw new Error("orders must contain at least 1 share");
  const notional = (priceMicro * shareMicro) / MICRO;
  return side === "BUY"
    ? { makerAmount: notional, takerAmount: shareMicro, notional }
    : { makerAmount: shareMicro, takerAmount: notional, notional };
}

export function estimateFee(shares: string, price: string, feeBps: number): string {
  const s = Number(shares);
  const p = Number(price);
  return (s * (feeBps / 10_000) * p * (1 - p)).toFixed(6);
}
