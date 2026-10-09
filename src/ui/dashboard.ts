import blessed from "blessed";
import { THEME } from "../constants.js";
import type { Category, ConvictionSummary, EventMarket, EventSummary, Market, OrderBook, WalletSession, XoEvent } from "../types.js";
import { PublicXoClient } from "../api/public-client.js";
import { TradingClient } from "../api/trading-client.js";
import { MarketSocket, type SocketState } from "../api/market-socket.js";
import { sessionLabel } from "../wallet/session.js";
import { runLadderOverlay, runOrdersOverlay, runProfileOverlay, runReadOnlyNotice, runTradeOverlay } from "./modal-workflows.js";

export type DashboardAction =
  { type: "exit" } |
  { type: "connect-wallet" };

const CONVICTIONS_CATEGORY_ID = -4;
const CONVICTIONS_CATEGORY: Category = {
  id: CONVICTIONS_CATEGORY_ID,
  name: "CONVICTIONS",
  description: "Creator-backed conviction markets"
};
const CONVICTION_EVENT_CATEGORY: Category = { id: CONVICTIONS_CATEGORY_ID, name: "CONVICT" };

function money(value?: string): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number);
}

function moneyNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function cents(value?: string): string {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? `${(number / 10_000).toFixed(1)}¢` : "—";
}

function timeRemaining(value?: string | null): string {
  if (!value) return "time unknown";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "time unknown";
  const seconds = Math.round((timestamp - Date.now()) / 1_000);
  if (seconds <= 0) return "ended";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${Math.max(1, minutes)}m left`;
}

function endTime(value?: string | null): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : "—";
}

function compactEndTime(value?: string | null): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false
  }).replace(",", "");
}

function metadataEnd(event: EventSummary): string | undefined {
  const value = event.metadata?.expiresAt ?? event.metadata?.endsAt;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function grossReturn(value?: string): string {
  const price = Number(value) / 1_000_000;
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return "—";
  const gain = 1 - price;
  const roi = (gain / price) * 100;
  return `+${(gain * 100).toFixed(1)}¢/share · +${roi.toFixed(1)}% ROI`;
}

function concise(value: unknown, max = 1_200): string {
  if (!value) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function rulesText(market: Market): string {
  if (!market.rules) return "No additional rules supplied.";
  if (typeof market.rules === "object") {
    const record = market.rules as Record<string, unknown>;
    for (const key of ["description", "rules", "text", "resolutionCriteria"]) {
      if (typeof record[key] === "string" && record[key]) return concise(record[key]);
    }
  }
  return concise(market.rules);
}

function eventLine(event: EventSummary, ending: string | undefined, width = 52): string {
  const end = compactEndTime(ending);
  if (width < 44) {
    const shortEnd = end === "—" ? "—" : new Date(Date.parse(ending!)).toLocaleString("en-GB", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
    }).replace(",", "");
    const titleWidth = Math.max(8, width - shortEnd.length - 1);
    return `${event.title.slice(0, titleWidth).padEnd(titleWidth)} {${THEME.warning}-fg}${shortEnd.padStart(11)}{/}`;
  }
  const category = (event.category?.name ?? "OTHER").slice(0, 9).padEnd(9);
  const marketCount = `${event.marketCount}m`.padStart(4);
  const endingLabel = end.padStart(15);
  const titleWidth = Math.max(8, width - category.length - marketCount.length - endingLabel.length - 3);
  return `{${THEME.muted}-fg}${category}{/} ${event.title.slice(0, titleWidth).padEnd(titleWidth)} ` +
    `{${THEME.warning}-fg}${endingLabel}{/} {${THEME.muted}-fg}${marketCount}{/}`;
}

function uniqueEvents(events: EventSummary[]): EventSummary[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = event.id || event.slug;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recentFirst(left: EventSummary, right: EventSummary): number {
  const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "") || 0;
  const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "") || 0;
  return rightTime - leftTime;
}

function flattenMarkets(event: XoEvent): EventMarket[] {
  const direct = event.markets ?? [];
  const nested = (event.subEvents ?? []).flatMap(flattenMarkets);
  return [...direct, ...nested]
    .filter((entry) => entry.market?.outcomes?.length >= 2)
    .sort((a, b) => (a.eventSortOrder ?? 0) - (b.eventSortOrder ?? 0));
}

function detailEnd(event: XoEvent): string | undefined {
  const values = flattenMarkets(event)
    .map((entry) => entry.market.expiresAt)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
  return values.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? metadataEnd(event);
}

function convictionEvent(conviction: ConvictionSummary): XoEvent {
  const market = conviction.market;
  return {
    id: conviction.id,
    slug: conviction.slug,
    title: conviction.title,
    subtitle: conviction.subtitle ?? null,
    description: conviction.description ?? null,
    category: CONVICTION_EVENT_CATEGORY,
    type: String(conviction.type ?? market.type ?? 4),
    marketCount: 1,
    directMarketCount: 1,
    subEventCount: 0,
    ...(conviction.createdAt ? { createdAt: conviction.createdAt } : {}),
    ...(conviction.updatedAt ? { updatedAt: conviction.updatedAt } : {}),
    metadata: { ...(conviction.metadata ?? {}), expiresAt: market.expiresAt, conditionId: market.conditionId },
    catalogSurface: "CONVICTIONS",
    markets: [{ eventId: conviction.id, eventSortOrder: 0, groupTitle: market.categoryPath?.at(-1)?.name ?? "Conviction", market }]
  };
}

function marketName(entry: EventMarket): string {
  return entry.groupTitle?.trim() || entry.market.title;
}

function outcomeLine(entry: EventMarket, width = 64): string {
  const yes = entry.market.outcomes.find((outcome) => outcome.title.toLowerCase() === "yes") ?? entry.market.outcomes[0];
  const no = entry.market.outcomes.find((outcome) => outcome.title.toLowerCase() === "no") ?? entry.market.outcomes[1];
  const status = entry.market.status === "ACTIVE" ? "" : `  ${entry.market.status}`;
  const nameWidth = Math.max(10, width - 29 - status.length);
  return `${marketName(entry).slice(0, nameWidth).padEnd(nameWidth)} ` +
    `{${THEME.yesText}-fg}{${THEME.yes}-bg} YES ${cents(yes?.currentPrice).padStart(6)} {/} ` +
    `{${THEME.noText}-fg}{${THEME.no}-bg} NO ${cents(no?.currentPrice).padStart(6)} {/}` +
    `{${THEME.muted}-fg}${status}{/}`;
}

function bookPrice(value?: string): string {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? `${(price * 100).toFixed(1)}¢` : "—";
}

function bookRow(level: { price: string; size: string }, color: string): string {
  const price = Number(level.price);
  const shares = Number(level.size);
  const total = Number.isFinite(price * shares) ? `$${(price * shares).toFixed(2)}` : "—";
  return `{${color}-fg}${bookPrice(level.price).padStart(8)}  ${level.size.padStart(12)}  ${total.padStart(11)}{/}`;
}

function bookPaneText(title: string, currentPrice: string | undefined, book?: OrderBook): string {
  const bids = book?.bids ?? [];
  const asks = book?.asks ?? [];
  const bestBid = bids[0];
  const bestAsk = asks[0];
  const spread = bestBid && bestAsk ? `${((Number(bestAsk.price) - Number(bestBid.price)) * 100).toFixed(1)}¢` : "—";
  const midpoint = bestBid && bestAsk ? `${((Number(bestAsk.price) + Number(bestBid.price)) * 50).toFixed(1)}¢` : bookPrice(currentPrice ? String(Number(currentPrice) / 1_000_000) : undefined);
  const askRows = asks.slice(0, 10).map((level) => bookRow(level, THEME.ask)).reverse();
  const bidRows = bids.slice(0, 10).map((level) => bookRow(level, THEME.bid));
  return `{bold}${title.toUpperCase()}  ${cents(currentPrice)}{/bold}\n` +
    `{${THEME.muted}-fg}best bid ${bookPrice(bestBid?.price)}  ·  best ask ${bookPrice(bestAsk?.price)}  ·  spread ${spread}{/}\n\n` +
    `{${THEME.muted}-fg}   PRICE        SHARES        TOTAL{/}\n` +
    `{${THEME.ask}-fg}ASKS{/}\n${askRows.join("\n") || `{${THEME.muted}-fg}   no asks{/}`}\n` +
    `{${THEME.border}-fg}────────────────────────────────────{/}\n` +
    `{bold}MID ${midpoint.padStart(8)}{/bold}  {${THEME.muted}-fg}last ${bookPrice(book?.last_trade_price)}{/}\n` +
    `{${THEME.border}-fg}────────────────────────────────────{/}\n` +
    `{${THEME.bid}-fg}BIDS{/}\n${bidRows.join("\n") || `{${THEME.muted}-fg}   no bids{/}`}`;
}

function cashLabel(raw: string): string {
  if (!/^\d+$/.test(raw)) return raw;
  const value = BigInt(raw);
  return `$${(Number(value) / 1_000_000).toFixed(2)}`;
}

export async function runDashboard(session?: WalletSession): Promise<DashboardAction> {
  const client = new PublicXoClient();
  let page = 1;
  let pageCount = 1;
  let itemCount = 0;
  let search = "";
  let localFilter = "";
  let categories: Category[] = [];
  let categoryId: number | undefined;
  let loadedEvents: EventSummary[] = [];
  let events: EventSummary[] = [];
  const pageCache = new Map<string, { data: EventSummary[]; pageCount: number; itemCount: number }>();
  const convictionDetails = new Map<string, XoEvent>();
  let eventIndex = 0;
  let eventDetail: XoEvent | undefined;
  let eventMarkets: EventMarket[] = [];
  let marketIndex = 0;
  let detailRequest = 0;
  let pageGeneration = 0;
  let bookOpen = false;
  let modalOpen = false;
  let accountStatus = session ? "checking account…" : "read only";
  const books = new Map<string, OrderBook>();
  const eventEndTimes = new Map<string, string | undefined>();
  const eventDetailPromises = new Map<string, Promise<XoEvent>>();
  let wsState: SocketState = "closed";
  let wsDetail = "";
  let resolve!: (action: DashboardAction) => void;
  const done = new Promise<DashboardAction>((value) => { resolve = value; });

  const screen = blessed.screen({ smartCSR: true, fullUnicode: true, title: "XO Market TUI", dockBorders: true, terminal: "xterm-256color", style: { bg: THEME.bg } });
  screen.program.hideCursor();
  const common = { tags: true, style: { fg: THEME.text, bg: THEME.panel, border: { fg: THEME.border } } } as const;
  const header = blessed.box({
    parent: screen, top: 0, left: 0, width: "100%", height: 3, tags: true,
    style: { fg: THEME.text, bg: THEME.panelAlt },
    content: ` {bold}{${THEME.yesText}-fg}{${THEME.yes}-bg} XO {/}  MARKET TERMINAL{/bold}`
  });
  const categoryBar = blessed.box({
    parent: screen, top: 3, left: 0, width: "100%", height: 1, tags: true,
    style: { fg: THEME.text, bg: THEME.panelAlt }
  });
  const eventList = blessed.list({
    parent: screen, top: 4, left: 0, width: "44%", bottom: 3, label: " EVENTS ", border: "line", ...common,
    keys: true, vi: true, mouse: true, scrollbar: { ch: "▌", style: { bg: THEME.yes } },
    style: { ...common.style, selected: { bg: THEME.focus, fg: THEME.text, bold: true }, item: { bg: THEME.panel } },
    padding: { left: 1, right: 1 }
  });
  const detail = blessed.box({
    parent: screen, top: 4, left: "44%", width: "56%", height: 12, label: " EVENT / MARKET DETAILS ", border: "line", ...common,
    scrollable: true, mouse: true, keys: true, padding: { left: 1, right: 1 }
  });
  const outcomeList = blessed.list({
    parent: screen, top: 16, left: "44%", width: "56%", bottom: 3, label: " OUTCOMES / RELATED MARKETS ", border: "line", ...common,
    keys: true, vi: true, mouse: true, scrollbar: { ch: "▌", style: { bg: THEME.no } },
    style: { ...common.style, selected: { bg: THEME.focus, fg: THEME.text, bold: true }, item: { bg: THEME.panel } },
    padding: { left: 1, right: 1 }
  });
  const bookOutcomeList = blessed.list({
    parent: screen, top: 4, left: "44%", width: "56%", height: 8, label: " EVENT OUTCOMES · SELECT A BINARY MARKET ", border: "line", ...common,
    hidden: true, keys: true, vi: true, mouse: true, scrollbar: { ch: "▌", style: { bg: THEME.no } },
    style: { ...common.style, selected: { bg: THEME.focus, fg: THEME.text, bold: true }, item: { bg: THEME.panel } },
    padding: { left: 1, right: 1 }
  });
  const yesBookPanel = blessed.box({
    parent: screen, top: 12, left: "44%", width: "28%", bottom: 3, label: " YES ORDER BOOK ", border: "line", ...common,
    hidden: true, scrollable: true, alwaysScroll: true, mouse: true, keys: true, padding: { left: 2, right: 1 }
  });
  const noBookPanel = blessed.box({
    parent: screen, top: 12, left: "72%", width: "28%", bottom: 3, label: " NO ORDER BOOK ", border: "line", ...common,
    hidden: true, scrollable: true, alwaysScroll: true, mouse: true, keys: true, padding: { left: 2, right: 1 }
  });
  const footer = blessed.box({ parent: screen, bottom: 0, left: 0, width: "100%", height: 3, tags: true, style: { fg: THEME.text, bg: THEME.panelAlt } });
  const prompt = blessed.prompt({ parent: screen, border: "line", height: 7, width: "70%", top: "center", left: "center", label: " Search XO events ", ...common });

  const socket = new MarketSocket({
    onBook: (book) => { books.set(book.asset_id, book); drawBook(); },
    onState: (state, message) => { wsState = state; wsDetail = message ?? ""; drawFooter(); }
  });

  function selectedEntry(): EventMarket | undefined { return eventMarkets[marketIndex]; }
  function listIndex(list: blessed.Widgets.ListElement): number { return (list as blessed.Widgets.ListElement & { selected: number }).selected; }
  function selectedCategory(): Category | undefined { return categories.find((category) => category.id === categoryId); }
  function isConvictionsView(): boolean { return categoryId === CONVICTIONS_CATEGORY_ID; }
  function catalogNoun(): string { return isConvictionsView() ? "convictions" : "events"; }
  function eventRowWidth(): number { return Math.max(24, Number(eventList.width) - 6 || 52); }
  function outcomeRowWidth(): number { return Math.max(40, Number(outcomeList.width) - 4 || 64); }
  function eventKey(event: EventSummary): string { return event.id || event.slug; }
  function eventEnding(event: EventSummary): string | undefined {
    const key = eventKey(event);
    if (eventEndTimes.has(key)) return eventEndTimes.get(key);
    const ending = metadataEnd(event);
    if (ending) eventEndTimes.set(key, ending);
    return ending;
  }
  function eventRows(): string[] { return events.map((event) => eventLine(event, eventEnding(event), eventRowWidth())); }
  function updateEventRow(index: number): void {
    const event = events[index];
    if (!event || index < 0) return;
    eventList.getItem(index).setContent(eventLine(event, eventEnding(event), eventRowWidth()));
  }
  function outcomeRows(): string[] { return eventMarkets.map((entry) => outcomeLine(entry, outcomeRowWidth())); }

  function drawPanelLabels(): void {
    const eventWidth = Math.max(20, Number(eventList.width) - 6 || 50);
    const eventLeft = eventWidth < 44 ? " EVENT" : " CATEGORY  EVENT";
    const eventRight = eventWidth < 44 ? "ENDS " : "ENDS             MKTS ";
    eventList.setLabel(`${eventLeft}${" ".repeat(Math.max(1, eventWidth - eventLeft.length - eventRight.length))}${eventRight}`);

    const outcomeWidth = Math.max(36, Number(outcomeList.width) - 2 || 62);
    const nameWidth = Math.max(10, outcomeRowWidth() - 29);
    const outcomeLabel = ` MARKET${" ".repeat(Math.max(1, nameWidth - 6))}YES${" ".repeat(10)}NO `;
    outcomeList.setLabel(outcomeLabel.slice(0, outcomeWidth));
    bookOutcomeList.setLabel(outcomeLabel.slice(0, outcomeWidth));
  }

  function filteredEvents(): EventSummary[] {
    const needle = localFilter.trim().toLowerCase();
    if (!needle) return loadedEvents;
    return loadedEvents.filter((event) => [event.title, event.subtitle, event.category?.name]
      .some((value) => value?.toLowerCase().includes(needle)));
  }

  function drawCategoryBar(): void {
    const choices = [{ id: undefined as number | undefined, name: "ALL" }, ...categories.map(({ id, name }) => ({ id, name }))];
    const active = Math.max(0, choices.findIndex((choice) => choice.id === categoryId));
    const visibleCount = Math.min(7, choices.length);
    const start = Math.max(0, Math.min(active - Math.floor(visibleCount / 2), choices.length - visibleCount));
    const tabs = choices.slice(start, start + visibleCount).map((choice) => choice.id === categoryId
      ? `{bold}{${THEME.yesText}-fg}{${THEME.yes}-bg} ${choice.name.slice(0, 10).toUpperCase()} {/}{/bold}`
      : `{${THEME.muted}-fg} ${choice.name.slice(0, 10).toUpperCase()} {/}`);
    categoryBar.setContent(` {${THEME.muted}-fg}‹{/} ${tabs.join(` {${THEME.border}-fg}│{/} `)} {${THEME.muted}-fg}›{/}   {${THEME.warning}-fg}[C]{/} feeds/categories`);
  }

  function drawHeader(): void {
    const event = events[eventIndex];
    const position = events.length ? `${eventIndex + 1}/${events.length}` : "0/0";
    const filter = selectedCategory()?.name ?? "ALL";
    const narrowed = localFilter ? ` · filter “${localFilter}”` : "";
    header.setContent(
      ` {bold}{${THEME.yesText}-fg}{${THEME.yes}-bg} XO {/}  MARKET TERMINAL{/bold}   ${event ? event.title.slice(0, 72) : "Loading…"}\n` +
      ` {${THEME.yes}-fg}${filter.toUpperCase()}{/}  {${THEME.muted}-fg}${position} · page ${page}/${pageCount} · ${itemCount} ${catalogNoun()}${narrowed} · ${sessionLabel(session)} · ${accountStatus}{/}`
    );
    drawPanelLabels();
    drawCategoryBar();
  }

  function drawFooter(message = ""): void {
    const stateColor = wsState === "live" ? THEME.bid : wsState === "stale" ? THEME.warning : THEME.muted;
    const keys = bookOpen
      ? "[↑↓] outcome  [O/Esc] close book  [T] trade  [L] ladder  [M] profile  [?] help  [Q] quit"
      : "[↑↓] navigate  [←→/C] feed  [/] search  [F] filter  [O] book  [T] trade  [L] ladder  [M] profile  [?] help  [Q] quit";
    footer.setContent(` {bold}${keys}{/bold}\n {${stateColor}-fg}● ${bookOpen ? wsState.toUpperCase() : "BOOK CLOSED"}{/} ${bookOpen ? wsDetail : "WebSocket connects when O opens this event"}${message ? `  {${THEME.warning}-fg}${message}{/}` : ""}`);
    screen.render();
  }

  function drawDetail(): void {
    const event = eventDetail;
    const entry = selectedEntry();
    detail.setScroll(0);
    if (!event) {
      detail.setContent(`{${THEME.muted}-fg}Loading event description and outcomes…{/}`);
      screen.render();
      return;
    }
    const eventDescription = event.description || event.subtitle || "No event description supplied.";
    const eventVolume = [...new Map(eventMarkets.map((item) => [item.market.conditionId, item.market])).values()]
      .reduce((total, market) => total + (Number(market.totalVolumeInUSD) || 0), 0);
    const eventEnd = eventMarkets
      .map((item) => item.market.expiresAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
    const yes = entry?.market.outcomes.find((outcome) => outcome.title.toLowerCase() === "yes") ?? entry?.market.outcomes[0];
    const no = entry?.market.outcomes.find((outcome) => outcome.title.toLowerCase() === "no") ?? entry?.market.outcomes[1];
    const selected = entry
      ? `\n{bold}${marketName(entry)}{/bold}  {${THEME.muted}-fg}${entry.market.status}{/}` +
        `\n{bold}Ends{/bold} ${endTime(entry.market.expiresAt)}  {${THEME.muted}-fg}(${timeRemaining(entry.market.expiresAt)}){/}` +
        `\n{bold}Volume{/bold} ${money(entry.market.totalVolumeInUSD)}` +
        `\n{${THEME.yesText}-fg}YES ${cents(yes?.currentPrice)}{/} → gross if correct ${grossReturn(yes?.currentPrice)}` +
        `\n{${THEME.noText}-fg}NO  ${cents(no?.currentPrice)}{/} → gross if correct ${grossReturn(no?.currentPrice)}` +
        `\n{${THEME.muted}-fg}Indicative current-price return before fees; execution price may differ.{/}` +
        `\n\n{bold}Market description{/bold} ${entry.market.description || entry.market.title}` +
        `\n{bold}Resolution{/bold} ${rulesText(entry.market)}` +
        `\n\n{bold}Event context{/bold} ${eventDescription}`
      : `\n\n${eventDescription}\n\nNo related binary outcome markets were returned.`;
    detail.setContent(`{bold}${event.title}{/bold}\n{${THEME.muted}-fg}${event.category?.name ?? "XO event"} · ${eventMarkets.length} related market${eventMarkets.length === 1 ? "" : "s"} · ${moneyNumber(eventVolume)} event volume · ${timeRemaining(eventEnd)}{/}${selected}`);
    screen.render();
  }

  function drawOutcomes(): void {
    outcomeList.setItems(outcomeRows());
    bookOutcomeList.setItems(outcomeRows());
    outcomeList.select(Math.min(marketIndex, Math.max(0, eventMarkets.length - 1)));
    bookOutcomeList.select(Math.min(marketIndex, Math.max(0, eventMarkets.length - 1)));
    drawDetail();
  }

  function drawBook(): void {
    if (!bookOpen) return;
    const entry = selectedEntry();
    if (!entry) {
      yesBookPanel.setContent("No outcome market selected.");
      noBookPanel.setContent("No outcome market selected.");
      screen.render();
      return;
    }
    const yes = entry.market.outcomes.find((outcome) => outcome.title.toLowerCase() === "yes") ?? entry.market.outcomes[0];
    const no = entry.market.outcomes.find((outcome) => outcome.title.toLowerCase() === "no") ?? entry.market.outcomes[1];
    yesBookPanel.setLabel(` YES · ${marketName(entry)} `);
    noBookPanel.setLabel(` NO · ${marketName(entry)} `);
    yesBookPanel.setContent(bookPaneText(yes?.title ?? "YES", yes?.currentPrice, yes ? books.get(yes.outcomeTokenId) : undefined));
    noBookPanel.setContent(bookPaneText(no?.title ?? "NO", no?.currentPrice, no ? books.get(no.outcomeTokenId) : undefined));
    screen.render();
  }

  async function loadAccount(): Promise<void> {
    if (!session) return;
    const trading = new TradingClient(session);
    const [positionsResult, ordersResult] = await Promise.allSettled([trading.getPositions(), trading.getOpenOrders()]);
    if (positionsResult.status === "fulfilled") {
      const positions = positionsResult.value;
      const nonzero = (positions.positions ?? []).filter((position) => Number(position.balance) > 0 || Number(position.reserved) > 0).length;
      const orders = ordersResult.status === "fulfilled" ? `${ordersResult.value.length} open orders` : "orders unavailable";
      accountStatus = `${cashLabel(positions.cash_balance)} · ${nonzero} positions · ${orders}`;
    } else {
      accountStatus = "wallet connected · account snapshot unavailable";
    }
    drawHeader();
    screen.render();
  }

  async function loadEvent(index: number): Promise<void> {
    const summary = events[index];
    if (!summary) return;
    eventIndex = index;
    eventDetail = undefined;
    eventMarkets = [];
    marketIndex = 0;
    const request = ++detailRequest;
    drawHeader();
    drawOutcomes();
    try {
      const key = eventKey(summary);
      let pending = eventDetailPromises.get(key);
      if (!pending) {
        if (summary.catalogSurface === "CONVICTIONS") {
          const embedded = convictionDetails.get(key);
          if (!embedded?.markets[0]) throw new Error("Conviction details are unavailable");
          const embeddedEntry = embedded.markets[0];
          pending = client.getMarket(embeddedEntry.market.conditionId).then((market) => ({
            ...embedded,
            markets: [{
              ...embeddedEntry,
              market: {
                ...market,
                outcomes: embeddedEntry.market.outcomes.map((outcome) => ({
                  ...market.outcomes.find((candidate) => candidate.outcomeTokenId === outcome.outcomeTokenId),
                  ...outcome
                }))
              }
            }]
          }));
        } else {
          pending = client.getEvent(summary.slug);
        }
        eventDetailPromises.set(key, pending);
        void pending.catch(() => eventDetailPromises.delete(key));
      }
      const loaded = await pending;
      if (request !== detailRequest) return;
      eventDetail = loaded;
      eventMarkets = flattenMarkets(loaded);
      eventEndTimes.set(key, detailEnd(loaded));
      updateEventRow(eventIndex);
      drawOutcomes();
      drawFooter();
    } catch (error) {
      if (request === detailRequest) drawFooter(`Event failed: ${(error as Error).message}`);
    }
  }

  async function loadPage(): Promise<void> {
    const generation = ++pageGeneration;
    socket.close();
    closeBook(false);
    const cacheKey = `${categoryId ?? "all"}:${search.trim().toLowerCase()}:${page}`;
    const cached = pageCache.get(cacheKey);

    const applyPage = async (snapshot: { data: EventSummary[]; pageCount: number; itemCount: number }): Promise<void> => {
      loadedEvents = snapshot.data;
      pageCount = snapshot.pageCount;
      itemCount = snapshot.itemCount;
      events = filteredEvents();
      eventIndex = 0;
      eventList.setItems(eventRows());
      eventList.select(0);
      eventList.focus();
      drawHeader();
      if (events.length) await loadEvent(0);
      else {
        eventDetail = undefined;
        eventMarkets = [];
        drawOutcomes();
        drawFooter("No events matched");
      }
      void hydrateEndTimes(events, generation);
    };

    if (cached) {
      await applyPage(cached);
      drawFooter("Cached page shown · refreshing…");
    } else {
      loadedEvents = [];
      events = [];
      eventDetail = undefined;
      eventMarkets = [];
      itemCount = 0;
      pageCount = 1;
      eventList.setItems([]);
      drawHeader();
      drawOutcomes();
      drawFooter("Loading events…");
    }
    try {
      let snapshot: { data: EventSummary[]; pageCount: number; itemCount: number };
      if (isConvictionsView()) {
        const result = await client.listConvictions({ page, take: 50, search, sortBy: "trending" });
        const adapted = result.data
          .filter((conviction) => conviction.market?.outcomes?.length >= 2)
          .map(convictionEvent);
        for (const event of adapted) convictionDetails.set(eventKey(event), event);
        snapshot = {
          data: adapted,
          pageCount: Math.max(1, result.meta.pageCount),
          itemCount: result.meta.itemCount
        };
      } else if (categoryId !== undefined || search || categories.length === 0) {
        const result = await client.listEvents({
          page,
          take: 50,
          search,
          ...(categoryId === undefined ? {} : { categoryId }),
          sortBy: "updatedAt",
          sortOrder: "DESC"
        });
        snapshot = {
          data: result.data,
          pageCount: Math.max(1, result.meta.pageCount),
          itemCount: result.meta.itemCount
        };
      } else {
        const pages = await Promise.all(categories.filter((category) => category.id !== CONVICTIONS_CATEGORY_ID).map((category) => client.listEvents({
          page,
          take: 3,
          categoryId: category.id,
          sortBy: "updatedAt",
          sortOrder: "DESC"
        })));
        snapshot = {
          data: uniqueEvents(pages.flatMap((result) => result.data)).sort(recentFirst),
          pageCount: Math.max(1, ...pages.map((result) => result.meta.pageCount)),
          itemCount: pages.reduce((total, result) => total + result.meta.itemCount, 0)
        };
      }
      pageCache.set(cacheKey, snapshot);
      await applyPage(snapshot);
    } catch (error) {
      drawFooter(`${cached ? "Showing cached page · refresh" : "Load"} failed: ${(error as Error).message}`);
    }
  }

  async function hydrateEndTimes(rows: EventSummary[], generation: number): Promise<void> {
    const queue = rows.filter((event) => !eventEnding(event));
    const worker = async (): Promise<void> => {
      for (;;) {
        const event = queue.shift();
        if (!event) return;
        const key = eventKey(event);
        try {
          let pending = eventDetailPromises.get(key);
          if (!pending) {
            pending = client.getEvent(event.slug);
            eventDetailPromises.set(key, pending);
            void pending.catch(() => eventDetailPromises.delete(key));
          }
          const loaded = await pending;
          eventEndTimes.set(key, detailEnd(loaded));
          if (generation === pageGeneration) {
            const index = events.findIndex((row) => eventKey(row) === key);
            updateEventRow(index);
            screen.render();
          }
        } catch { /* Overview hydration is best-effort; selected-event errors remain visible. */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()));
  }

  async function loadCatalog(): Promise<void> {
    try {
      categories = [CONVICTIONS_CATEGORY, ...await client.listCategories()];
      drawCategoryBar();
    } catch (error) {
      categories = [];
      drawFooter(`Categories unavailable: ${(error as Error).message}`);
    }
    await loadPage();
  }

  async function chooseCategory(): Promise<void> {
    if (modalOpen) return;
    modalOpen = true;
    const choices: Array<{ label: string; category?: Category }> = [
      { label: "ALL        Mixed recent events from every XO market category" },
      ...categories.map((category) => ({
        label: `${category.name.padEnd(11)}${category.description ?? ""}`,
        category
      }))
    ];
    const picker = blessed.list({
      parent: screen,
      top: "center",
      left: "center",
      width: "64%",
      height: Math.min(24, choices.length + 4),
      label: " Browse XO feeds and categories · Enter select · Esc close ",
      border: "line",
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      padding: { left: 1, right: 1 },
      scrollbar: { ch: "▌", style: { bg: THEME.yes } },
      style: { ...common.style, selected: { bg: THEME.focus, fg: THEME.text, bold: true }, item: { bg: THEME.panel } }
    });
    picker.setItems(choices.map((choice) => choice.label));
    picker.select(Math.max(0, choices.findIndex((choice) => choice.category?.id === categoryId)));
    picker.focus();
    screen.render();

    await new Promise<void>((resolvePicker) => {
      const close = (): void => {
        picker.destroy();
        modalOpen = false;
        eventList.focus();
        screen.render();
        resolvePicker();
      };
      picker.key(["escape", "q"], close);
      picker.key(["enter"], () => {
        const choice = choices[listIndex(picker)];
        categoryId = choice?.category?.id;
        page = 1;
        localFilter = "";
        close();
        void loadPage();
      });
    });
  }

  function cycleCategory(delta: number): void {
    const choices: Array<number | undefined> = [undefined, ...categories.map((category) => category.id)];
    const current = choices.findIndex((id) => id === categoryId);
    const next = (Math.max(0, current) + delta + choices.length) % choices.length;
    categoryId = choices[next];
    page = 1;
    localFilter = "";
    void loadPage();
  }

  async function applyLocalFilter(): Promise<void> {
    events = filteredEvents();
    eventIndex = 0;
    eventList.setItems(eventRows());
    eventList.select(0);
    eventList.focus();
    if (events.length) await loadEvent(0);
    else {
      eventDetail = undefined;
      eventMarkets = [];
      marketIndex = 0;
      drawHeader();
      drawOutcomes();
      drawFooter("No loaded events match the local filter");
    }
  }

  async function showHelp(): Promise<void> {
    await runModal(() => new Promise<void>((resolveHelp) => {
      const help = blessed.box({
        parent: screen,
        top: "center",
        left: "center",
        width: "72%",
        height: 24,
        label: " XO TUI help · ?/Esc/q close ",
        border: "line",
        tags: true,
        keys: true,
        mouse: true,
        scrollable: true,
        padding: { left: 2, right: 2 },
        style: common.style,
        content:
          `{bold}DISCOVER{/bold}\n` +
          `{${THEME.yes}-fg}← / →{/}      Previous / next XO feed or category\n` +
          `{${THEME.yes}-fg}C{/}          Browse Markets, Convictions, and categories\n` +
          `{${THEME.yes}-fg}/{/}          Search the active Markets or Convictions feed\n` +
          `{${THEME.yes}-fg}F{/}          Instantly filter only the currently loaded page\n` +
          `{${THEME.yes}-fg}PgUp/PgDn{/}  Previous / next catalog page\n` +
          `{${THEME.yes}-fg}R{/}          Refresh the active category and page\n\n` +
          `{bold}INSPECT{/bold}\n` +
          `{${THEME.no}-fg}↑ / ↓{/}      Select events or related outcome markets\n` +
          `{${THEME.no}-fg}Tab/Enter{/}  Move between events and outcomes\n` +
          `{${THEME.no}-fg}O{/}          Open the in-place live YES/NO books; O/Esc closes\n\n` +
          `{bold}MANUAL TRADING{/bold}\n` +
          `{${THEME.warning}-fg}T{/}          Build and review one manual order\n` +
          `{${THEME.warning}-fg}L{/}          Build and review a manual price ladder\n` +
          `{${THEME.warning}-fg}M{/}          Open My Profile: active markets, positions, and cancelable orders\n` +
          `{${THEME.warning}-fg}P{/}          Inspect open orders and choose cancellations\n\n` +
          `{${THEME.muted}-fg}The WebSocket is display-only. Nothing submits, reprices, or cancels automatically.{/}`
      });
      help.focus();
      screen.render();
      const close = (): void => { help.destroy(); resolveHelp(); };
      help.key(["?", "escape", "q"], close);
    }));
  }

  async function openBook(): Promise<void> {
    if (!eventMarkets.length) { drawFooter("This event has no order-book markets"); return; }
    bookOpen = true;
    detail.hide(); outcomeList.hide();
    bookOutcomeList.show(); yesBookPanel.show(); noBookPanel.show();
    bookOutcomeList.select(marketIndex); bookOutcomeList.focus();
    books.clear(); drawBook(); drawFooter("Loading exact books…");
    const tokenIds = eventMarkets.flatMap((entry) => entry.market.outcomes.map((outcome) => outcome.outcomeTokenId));
    try {
      const snapshots = await client.getBooks(tokenIds);
      for (const book of snapshots) books.set(book.asset_id, book);
    } catch (error) { drawFooter(`REST snapshot: ${(error as Error).message}`); }
    socket.connect(tokenIds);
    drawBook(); drawFooter();
  }

  function closeBook(render = true): void {
    if (!bookOpen) return;
    bookOpen = false;
    socket.close(); books.clear();
    bookOutcomeList.hide(); yesBookPanel.hide(); noBookPanel.hide();
    eventList.show(); detail.show(); outcomeList.show();
    outcomeList.select(marketIndex); outcomeList.focus();
    if (render) drawFooter();
  }

  function finish(action: DashboardAction): void { socket.close(); screen.destroy(); resolve(action); }

  async function runModal(task: () => Promise<void>): Promise<void> {
    if (modalOpen) return;
    modalOpen = true;
    try { await task(); }
    finally {
      modalOpen = false;
      if (bookOpen) bookOutcomeList.focus(); else outcomeList.focus();
      drawDetail(); drawBook(); drawFooter();
    }
  }

  async function withWallet(task: (activeSession: WalletSession) => Promise<void>): Promise<void> {
    if (!session) { await runModal(() => runReadOnlyNotice(screen)); return; }
    await runModal(() => task(session));
  }

  eventList.on("select item", (_item, index) => { if (!bookOpen && !modalOpen) void loadEvent(index); });
  eventList.on("keypress", (_ch, key) => {
    if (!bookOpen && !modalOpen && ["up", "down", "j", "k"].includes(key.name ?? "")) {
      setTimeout(() => { const index = listIndex(eventList); if (index !== eventIndex) void loadEvent(index); }, 0);
    }
  });
  const selectMarketFrom = (list: blessed.Widgets.ListElement): void => {
    const index = listIndex(list);
    if (index >= 0 && index < eventMarkets.length) {
      marketIndex = index;
      outcomeList.select(index); bookOutcomeList.select(index);
      drawDetail(); drawBook();
    }
  };
  outcomeList.on("select item", () => selectMarketFrom(outcomeList));
  outcomeList.on("keypress", (_ch, key) => { if (["up", "down", "j", "k"].includes(key.name ?? "")) setTimeout(() => selectMarketFrom(outcomeList), 0); });
  bookOutcomeList.on("select item", () => selectMarketFrom(bookOutcomeList));
  bookOutcomeList.on("keypress", (_ch, key) => { if (["up", "down", "j", "k"].includes(key.name ?? "")) setTimeout(() => selectMarketFrom(bookOutcomeList), 0); });

  screen.on("resize", () => {
    eventList.setItems(eventRows());
    outcomeList.setItems(outcomeRows());
    bookOutcomeList.setItems(outcomeRows());
    eventList.select(Math.min(eventIndex, Math.max(0, events.length - 1)));
    outcomeList.select(Math.min(marketIndex, Math.max(0, eventMarkets.length - 1)));
    bookOutcomeList.select(Math.min(marketIndex, Math.max(0, eventMarkets.length - 1)));
    drawHeader();
    drawDetail();
    drawBook();
    drawFooter();
  });

  screen.key(["q", "C-c"], () => { if (!modalOpen) finish({ type: "exit" }); });
  screen.key(["escape"], () => { if (!modalOpen && bookOpen) closeBook(); });
  screen.key(["tab"], () => {
    if (bookOpen || modalOpen) return;
    if (screen.focused === eventList) outcomeList.focus(); else eventList.focus();
    screen.render();
  });
  screen.key(["r"], () => { if (!bookOpen && !modalOpen) void loadPage(); });
  screen.key(["c"], () => { if (!bookOpen && !modalOpen) void chooseCategory(); });
  screen.key(["left"], () => { if (!bookOpen && !modalOpen) cycleCategory(-1); });
  screen.key(["right"], () => { if (!bookOpen && !modalOpen) cycleCategory(1); });
  screen.key(["?"], () => { if (!modalOpen) void showHelp(); });
  screen.key(["pageup"], () => { if (!bookOpen && !modalOpen) { page = Math.max(1, page - 1); void loadPage(); } });
  screen.key(["pagedown"], () => { if (!bookOpen && !modalOpen) { page = Math.min(pageCount, page + 1); void loadPage(); } });
  screen.key(["/"], () => {
    if (!bookOpen && !modalOpen) {
      modalOpen = true;
      prompt.setLabel(` Search XO ${catalogNoun()} · Enter apply `);
      prompt.input(isConvictionsView() ? "Conviction title" : "Event title", search, (_error, value) => {
        modalOpen = false; search = value?.trim() ?? ""; page = 1; void loadPage();
      });
    }
  });
  screen.key(["f"], () => {
    if (!bookOpen && !modalOpen) {
      modalOpen = true;
      prompt.setLabel(" Filter this loaded page · Enter apply ");
      prompt.input("Title, subtitle, or category", localFilter, (_error, value) => {
        modalOpen = false;
        localFilter = value?.trim() ?? "";
        void applyLocalFilter();
      });
    }
  });
  screen.key(["w"], () => {
    if (modalOpen) return;
    if (session) drawFooter(`Wallet ${sessionLabel(session)} is connected`);
    else finish({ type: "connect-wallet" });
  });
  screen.key(["m"], () => {
    if (!modalOpen) void withWallet(async (active) => {
      await runProfileOverlay(screen, active);
      await loadAccount();
    });
  });
  screen.key(["p"], () => { if (!modalOpen) void withWallet((active) => runOrdersOverlay(screen, active)); });
  screen.key(["o"], () => { if (!modalOpen) { if (bookOpen) closeBook(); else void openBook(); } });
  screen.key(["t"], () => {
    if (modalOpen) return;
    const entry = selectedEntry();
    if (entry?.market.status === "ACTIVE") void withWallet((active) => runTradeOverlay(screen, entry.market, active));
    else drawFooter("Trading requires an ACTIVE outcome market");
  });
  screen.key(["l"], () => {
    if (modalOpen) return;
    const entry = selectedEntry();
    if (entry?.market.status === "ACTIVE") void withWallet((active) => runLadderOverlay(screen, entry.market, active));
    else drawFooter("Ladders require an ACTIVE outcome market");
  });
  screen.key(["enter"], () => { if (!modalOpen && !bookOpen && screen.focused === eventList) outcomeList.focus(); });

  screen.render();
  void Promise.all([loadCatalog(), loadAccount()]);
  return done;
}
