import { createHmac } from "node:crypto";
import type { WalletSession } from "../types.js";

function decodeSecret(secret: string): Buffer {
  const normalized = secret.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64");
}

export function canonicalTarget(url: URL, mode: WalletSession["hmacMode"]): string {
  return mode === "path-with-query" ? `${url.pathname}${url.search}` : url.pathname;
}

export function signHmac(secret: string, timestamp: string, method: string, target: string, body = ""): string {
  return createHmac("sha256", decodeSecret(secret))
    .update(`${timestamp}${method.toUpperCase()}${target}${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function authHeaders(session: WalletSession, method: string, url: URL, body = "", now = new Date()): Record<string, string> {
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  return {
    XO_ADDRESS: session.smartAccount,
    XO_API_KEY: session.apiKey,
    XO_PASSPHRASE: session.apiPassphrase,
    XO_TIMESTAMP: timestamp,
    XO_SIGNATURE: signHmac(session.apiSecret, timestamp, method, canonicalTarget(url, session.hmacMode), body)
  };
}

export function redactError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/0x[0-9a-fA-F]{64,}/g, "[REDACTED]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[REDACTED]")
    .slice(0, 600);
}
