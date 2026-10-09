import { XO } from "../constants.js";
import type { Category, ConvictionPage, EventPage, Market, MarketPage, OrderBook, XoEvent } from "../types.js";

export interface MarketQuery {
  page?: number;
  take?: number;
  search?: string;
  statuses?: string;
  categories?: string;
  sortBy?: "createdAt" | "expiresAt" | "totalVolumeInUSD" | "liquidity" | "endingSoon";
  sortOrder?: "ASC" | "DESC";
}

export interface EventQuery {
  page?: number;
  take?: number;
  search?: string;
  categoryId?: number;
  sortBy?: "createdAt" | "updatedAt";
  sortOrder?: "ASC" | "DESC";
}

export interface ConvictionQuery {
  page?: number;
  take?: number;
  search?: string;
  sortBy?: "trending" | "newest" | "closingSoon" | "volume" | "liquidity" | "priorityScore";
}

async function checkedJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail = typeof body === "object" && body && "message" in body ? String((body as { message: unknown }).message) : text;
    throw new Error(`${response.status} ${url.pathname}: ${detail.slice(0, 180)}`);
  }
  return body as T;
}

export class PublicXoClient {
  constructor(
    private readonly dataApi = XO.dataApi,
    private readonly orderbookApi = XO.orderbookApi
  ) {}

  async listMarkets(query: MarketQuery = {}): Promise<MarketPage> {
    const url = new URL(`${this.dataApi}/markets`);
    url.searchParams.set("page", String(query.page ?? 1));
    url.searchParams.set("take", String(Math.min(50, query.take ?? 50)));
    url.searchParams.set("marketScope", "onlyClob");
    url.searchParams.set("statuses", query.statuses ?? "ACTIVE");
    url.searchParams.set("sortBy", query.sortBy ?? "totalVolumeInUSD");
    url.searchParams.set("sortOrder", query.sortOrder ?? "DESC");
    if (query.search?.trim()) url.searchParams.set("search", query.search.trim());
    if (query.categories?.trim()) url.searchParams.set("categories", query.categories.trim());
    const page = await checkedJson<MarketPage>(url);
    if (!Array.isArray(page.data) || !page.meta) throw new Error("XO returned an invalid market page");
    return page;
  }

  async listEvents(query: EventQuery = {}): Promise<EventPage> {
    const url = new URL(`${this.dataApi}/v1/events`);
    url.searchParams.set("page", String(query.page ?? 1));
    url.searchParams.set("take", String(Math.min(50, query.take ?? 50)));
    if (query.search?.trim()) url.searchParams.set("search", query.search.trim());
    if (query.categoryId !== undefined) url.searchParams.set("categoryId", String(query.categoryId));
    if (query.sortBy) url.searchParams.set("sortBy", query.sortBy);
    if (query.sortOrder) url.searchParams.set("sortOrder", query.sortOrder);
    const page = await checkedJson<EventPage>(url);
    if (!Array.isArray(page.data) || !page.meta) throw new Error("XO returned an invalid event page");
    return page;
  }

  async listConvictions(query: ConvictionQuery = {}): Promise<ConvictionPage> {
    const url = new URL(`${this.dataApi}/convictions`);
    url.searchParams.set("page", String(query.page ?? 1));
    url.searchParams.set("take", String(Math.min(50, query.take ?? 50)));
    url.searchParams.set("sortBy", query.sortBy ?? "trending");
    url.searchParams.set("marketScope", "onlyConviction");
    url.searchParams.set("statuses", "ACTIVE");
    if (query.search?.trim()) url.searchParams.set("search", query.search.trim());
    const page = await checkedJson<ConvictionPage>(url);
    if (!Array.isArray(page.data) || !page.meta) throw new Error("XO returned an invalid conviction page");
    return page;
  }

  async listCategories(): Promise<Category[]> {
    const url = new URL(`${this.dataApi}/categories`);
    const categories = await checkedJson<Category[]>(url);
    if (!Array.isArray(categories)) throw new Error("XO returned an invalid category list");
    return categories
      .filter((category) => Number.isInteger(category.id) && Boolean(category.name) && category.isActive !== false)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getEvent(slug: string): Promise<XoEvent> {
    const url = new URL(`${this.dataApi}/v1/events/slug/${encodeURIComponent(slug)}`);
    const response = await checkedJson<{ data: XoEvent }>(url);
    if (!response.data || !Array.isArray(response.data.markets)) throw new Error("XO returned an invalid event");
    return response.data;
  }

  async getMarket(conditionId: string): Promise<Market> {
    const url = new URL(`${this.dataApi}/markets/contract/${encodeURIComponent(conditionId)}`);
    return checkedJson<Market>(url);
  }

  async findActiveMarketsByTokenIds(tokenIds: string[]): Promise<Market[]> {
    const remaining = new Set(tokenIds.filter(Boolean));
    if (remaining.size === 0) return [];
    const matches: Market[] = [];
    let page = 1;
    let pageCount = 1;
    do {
      const result = await this.listMarkets({ page, take: 50, statuses: "ACTIVE" });
      pageCount = Math.max(1, result.meta.pageCount);
      for (const market of result.data) {
        if (!market.outcomes.some((outcome) => remaining.has(outcome.outcomeTokenId))) continue;
        matches.push(market);
        for (const outcome of market.outcomes) remaining.delete(outcome.outcomeTokenId);
      }
      page += 1;
    } while (remaining.size > 0 && page <= pageCount);
    return matches;
  }

  async getBook(tokenId: string): Promise<OrderBook> {
    const url = new URL("/book", this.orderbookApi);
    url.searchParams.set("token_id", tokenId);
    const book = await checkedJson<OrderBook>(url);
    if (!Array.isArray(book.bids) || !Array.isArray(book.asks)) throw new Error("XO returned an invalid order book");
    return book;
  }

  async getBooks(tokenIds: string[]): Promise<OrderBook[]> {
    if (tokenIds.length === 0) return [];
    const unique = [...new Set(tokenIds)];
    const books: OrderBook[] = [];
    for (let offset = 0; offset < unique.length; offset += 100) {
      const url = new URL("/books", this.orderbookApi);
      const chunk = unique.slice(offset, offset + 100);
      books.push(...await checkedJson<OrderBook[]>(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(chunk.map((token_id) => ({ token_id })))
      }));
    }
    return books;
  }

  async getFeeRateBps(tokenId: string): Promise<number> {
    const url = new URL("/fee-rate", this.orderbookApi);
    url.searchParams.set("token_id", tokenId);
    const body = await checkedJson<{ base_fee: number | string }>(url);
    const fee = Number(body.base_fee);
    if (!Number.isFinite(fee) || fee < 0) throw new Error("XO returned an invalid fee rate");
    return fee;
  }
}
