import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicXoClient } from "../src/api/public-client.js";

const emptyMeta = {
  page: 1,
  take: 3,
  itemCount: 0,
  pageCount: 0,
  hasPreviousPage: false,
  hasNextPage: false
};

afterEach(() => vi.unstubAllGlobals());

describe("PublicXoClient event discovery", () => {
  it("sends category and recency controls to the event catalog", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [], meta: emptyMeta }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new PublicXoClient("https://example.test/api", "https://books.example.test");
    await client.listEvents({ categoryId: 1, page: 2, take: 3, sortBy: "updatedAt", sortOrder: "DESC" });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v1/events");
    expect(url.searchParams.get("categoryId")).toBe("1");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("take")).toBe("3");
    expect(url.searchParams.get("sortBy")).toBe("updatedAt");
    expect(url.searchParams.get("sortOrder")).toBe("DESC");
  });

  it("keeps only active categories and sorts their names", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { id: 2, name: "SPORTS", isActive: true },
      { id: 99, name: "WEATHER", isActive: false },
      { id: 1, name: "CRYPTO", isActive: true }
    ]), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new PublicXoClient("https://example.test/api", "https://books.example.test");
    const categories = await client.listCategories();

    expect(categories.map((category) => category.name)).toEqual(["CRYPTO", "SPORTS"]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://example.test/api/categories");
  });

  it("loads active conviction markets from XO's separate conviction feed", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [], meta: emptyMeta }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new PublicXoClient("https://example.test/api", "https://books.example.test");
    await client.listConvictions({ page: 2, take: 10, search: "bitcoin", sortBy: "newest" });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/convictions");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("take")).toBe("10");
    expect(url.searchParams.get("search")).toBe("bitcoin");
    expect(url.searchParams.get("sortBy")).toBe("newest");
    expect(url.searchParams.get("marketScope")).toBe("onlyConviction");
    expect(url.searchParams.get("statuses")).toBe("ACTIVE");
  });

  it("scans active market pages only until every requested position token is identified", async () => {
    const market = (conditionId: string, tokenId: string) => ({
      id: 1,
      conditionId,
      title: conditionId,
      slug: conditionId,
      status: "ACTIVE",
      outcomes: [{ id: 1, title: "Yes", outcomeTokenId: tokenId, currentPrice: "500000", index: 0 }]
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page"));
      const data = page === 1 ? [market("first", "token-a")] : [market("second", "token-b")];
      return new Response(JSON.stringify({
        data,
        meta: { ...emptyMeta, page, take: 50, itemCount: 100, pageCount: 2, hasNextPage: page < 2 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new PublicXoClient("https://example.test/api", "https://books.example.test");
    const matches = await client.findActiveMarketsByTokenIds(["token-a", "token-b"]);

    expect(matches.map((item) => item.conditionId)).toEqual(["first", "second"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [input] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("statuses")).toBe("ACTIVE");
      expect(url.searchParams.get("take")).toBe("50");
    }
  });
});
