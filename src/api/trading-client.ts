import { XO } from "../constants.js";
import type { OpenOrder, OrderDraft, Position, WalletSession } from "../types.js";
import { authHeaders, redactError } from "./auth.js";
import { buildUnsignedOrder, serializeOrder, signOrder } from "../trading/signing.js";

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body as T;
}

export class TradingClient {
  constructor(private readonly session: WalletSession, private readonly apiBase = XO.orderbookApi) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.apiBase);
    const payload = body === undefined ? "" : JSON.stringify(body, (_, value) => typeof value === "bigint" ? value.toString() : value);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...(payload ? { "content-type": "application/json" } : {}),
          ...authHeaders(this.session, method, url, payload)
        },
        ...(payload ? { body: payload } : {}),
        signal: AbortSignal.timeout(15_000)
      });
      return await parseResponse<T>(response);
    } catch (error) {
      throw new Error(redactError(error));
    }
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    const path = `/orders?address=${encodeURIComponent(this.session.smartAccount)}`;
    const page = await this.request<{ data: OpenOrder[] }>("GET", path);
    return page.data ?? [];
  }

  async getPositions(): Promise<{ cash_balance: string; positions: Position[] }> {
    // XO exposes portfolio positions by address. Keep this read path usable even
    // when an API-key triplet is expired; mutations still require HMAC auth.
    const url = new URL("/positions", this.apiBase);
    url.searchParams.set("address", this.session.smartAccount);
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return parseResponse(response);
  }

  async placeDrafts(drafts: OrderDraft[]): Promise<unknown[]> {
    if (drafts.length === 0 || drafts.length > 100) throw new Error("Select between 1 and 100 ladder rows");
    const signed = await Promise.all(drafts.map(async (draft) => {
      const order = buildUnsignedOrder(draft, this.session.smartAccount);
      return {
        order: serializeOrder(order, await signOrder(order, this.session)),
        orderType: draft.timeInForce,
        postOnly: draft.postOnly,
        funder: this.session.smartAccount
      };
    }));
    const response = await this.request<{ results?: unknown[] } | unknown[]>("POST", "/orders", signed);
    return Array.isArray(response) ? response : response.results ?? [];
  }

  async cancel(orderHashes: string[]): Promise<{ canceled: string[]; notCanceled: Record<string, string> }> {
    if (orderHashes.length === 0) throw new Error("No orders selected");
    return this.request("DELETE", "/orders", orderHashes);
  }
}
