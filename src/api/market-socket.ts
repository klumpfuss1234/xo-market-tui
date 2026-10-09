import WebSocket from "ws";
import type { OrderBook, PriceLevel } from "../types.js";
import { XO } from "../constants.js";

export type SocketState = "connecting" | "live" | "reconnecting" | "stale" | "closed";

interface BookEvent {
  event_type: "book";
  asset_id: string;
  market: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  timestamp: string;
  hash: string;
}

interface PriceChangeEvent {
  event_type: "price_change";
  market: string;
  timestamp: string;
  price_changes: Array<{ asset_id: string; price: string; size: string; side: "BUY" | "SELL"; hash: string }>;
}

type MarketEvent = BookEvent | PriceChangeEvent | { event_type?: string; type?: string; [key: string]: unknown };

export interface MarketSocketOptions {
  onBook: (book: OrderBook) => void;
  onState: (state: SocketState, detail?: string) => void;
  onEvent?: (event: MarketEvent) => void;
}

function sortBook(levels: Map<string, string>, side: "bids" | "asks"): PriceLevel[] {
  return [...levels.entries()]
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => side === "bids" ? Number(b.price) - Number(a.price) : Number(a.price) - Number(b.price));
}

export class MarketSocket {
  private socket: WebSocket | undefined;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private staleTimer?: NodeJS.Timeout;
  private lastMessageAt = 0;
  private tokenIds: string[] = [];
  private books = new Map<string, OrderBook>();

  constructor(private readonly options: MarketSocketOptions, private readonly wsUrl = "wss://orderbooks.xo.market/ws/market") {}

  connect(tokenIds: string[]): void {
    const normalized = [...new Set(tokenIds)];
    const sameSubscription = normalized.length === this.tokenIds.length && normalized.every((id, index) => id === this.tokenIds[index]);
    if (sameSubscription && this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) return;
    this.close();
    this.stopped = false;
    this.tokenIds = normalized;
    this.books.clear();
    this.open("connecting");
  }

  private open(state: SocketState): void {
    if (this.stopped || this.tokenIds.length === 0) return;
    this.options.onState(state);
    const ws = new WebSocket(this.wsUrl);
    this.socket = ws;
    ws.on("open", () => {
      this.reconnectAttempt = 0;
      this.lastMessageAt = Date.now();
      ws.send(JSON.stringify({
        type: "market",
        assets_ids: this.tokenIds,
        custom_feature_enabled: true,
        initial_dump: true
      }));
      this.options.onState("live");
      this.startStaleCheck();
    });
    ws.on("message", (data) => this.handle(String(data)));
    ws.on("error", (error) => this.options.onState("reconnecting", error.message));
    ws.on("close", () => this.scheduleReconnect());
  }

  private handle(raw: string): void {
    this.lastMessageAt = Date.now();
    let event: MarketEvent;
    try { event = JSON.parse(raw) as MarketEvent; } catch { return; }
    this.options.onEvent?.(event);
    if (event.event_type === "book") {
      const snapshot = event as BookEvent;
      const book: OrderBook = {
        market: snapshot.market,
        asset_id: snapshot.asset_id,
        // The production feed currently emits decimal, human-readable shares
        // (for example "371"), matching the REST /book response.
        bids: snapshot.bids.map((level) => ({ price: level.price, size: level.size })),
        asks: snapshot.asks.map((level) => ({ price: level.price, size: level.size })),
        timestamp: snapshot.timestamp,
        hash: snapshot.hash,
        min_order_size: "0",
        tick_size: String(XO.tickSize),
        last_trade_price: "0"
      };
      this.books.set(book.asset_id, book);
      this.options.onBook(book);
      return;
    }
    if (event.event_type === "price_change") {
      const delta = event as PriceChangeEvent;
      for (const change of delta.price_changes) {
        const previous = this.books.get(change.asset_id);
        if (!previous) continue;
        const side = change.side === "BUY" ? "bids" : "asks";
        const levels = new Map(previous[side].map((level) => [level.price, level.size]));
        if (Number(change.size) === 0) levels.delete(change.price); else levels.set(change.price, change.size);
        const next = { ...previous, [side]: sortBook(levels, side), timestamp: delta.timestamp, hash: change.hash };
        this.books.set(change.asset_id, next);
        this.options.onBook(next);
      }
    }
  }

  private startStaleCheck(): void {
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = setInterval(() => {
      if (this.stopped || !this.socket) return;
      if (Date.now() - this.lastMessageAt > 45_000) {
        this.options.onState("stale", "No market message for 45s; reconnecting");
        this.socket.terminate();
      }
    }, 5_000);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.staleTimer) clearInterval(this.staleTimer);
    const delay = Math.min(15_000, 1_000 * 2 ** this.reconnectAttempt++);
    this.options.onState("reconnecting", `retry in ${(delay / 1000).toFixed(0)}s`);
    this.reconnectTimer = setTimeout(() => this.open("reconnecting"), delay);
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.removeAllListeners();
      socket.on("error", () => undefined);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    }
    this.options.onState("closed");
  }
}
