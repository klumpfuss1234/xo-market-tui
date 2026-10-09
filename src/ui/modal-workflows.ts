import blessed from "blessed";
import type { Market, OpenOrder, OrderDraft, Outcome, Position, Side, TimeInForce, WalletSession } from "../types.js";
import { THEME } from "../constants.js";
import { PublicXoClient } from "../api/public-client.js";
import { TradingClient } from "../api/trading-client.js";
import { buildLadder, validateDraft } from "../trading/validation.js";
import { estimateFee, formatFixed6, parseFixed6 } from "../trading/units.js";

type Screen = blessed.Widgets.Screen;
type Choice<T> = { label: string; value: T };

function draftId(): string { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function modalStyle() {
  return { fg: THEME.text, bg: THEME.panel, border: { fg: THEME.accent }, selected: { bg: THEME.focus, fg: THEME.text, bold: true } };
}

function selectedIndex(list: blessed.Widgets.ListElement): number {
  return (list as blessed.Widgets.ListElement & { selected: number }).selected;
}

async function choose<T>(screen: Screen, title: string, choices: Choice<T>[], initial = 0): Promise<T | undefined> {
  return new Promise((resolve) => {
    const list = blessed.list({
      parent: screen, top: "center", left: "center", width: "72%", height: Math.min(choices.length + 6, 24),
      label: ` ${title} `, border: "line", tags: true, keys: true, vi: true, mouse: true,
      padding: { left: 2, right: 2 }, items: choices.map((choice) => choice.label), style: modalStyle()
    });
    list.setFront(); list.select(Math.max(0, Math.min(initial, choices.length - 1))); list.focus(); screen.render();
    let settled = false;
    const finish = (value?: T) => {
      if (settled) return;
      settled = true; list.destroy(); screen.render(); resolve(value);
    };
    list.key(["enter"], () => finish(choices[selectedIndex(list)]?.value));
    list.key(["escape", "q"], () => finish());
  });
}

async function ask(screen: Screen, title: string, label: string, initial = "", validator?: (value: string) => string | undefined): Promise<string | undefined> {
  while (true) {
    const value = await new Promise<string | undefined>((resolve) => {
      const prompt = blessed.prompt({
        parent: screen, top: "center", left: "center", width: "72%", height: 8,
        label: ` ${title} `, border: "line", tags: true, padding: { left: 2, right: 2 }, style: modalStyle()
      });
      prompt.setFront(); screen.render();
      prompt.input(label, initial, (error, answer) => {
        prompt.destroy(); screen.render();
        resolve(error || answer == null ? undefined : answer.trim());
      });
    });
    if (value === undefined) return undefined;
    const issue = validator?.(value);
    if (!issue) return value;
    await notice(screen, "Invalid value", issue);
  }
}

async function notice(screen: Screen, title: string, content: string, continueLabel = "Enter/Esc to return"): Promise<boolean> {
  return new Promise((resolve) => {
    const box = blessed.box({
      parent: screen, top: "center", left: "center", width: "88%", height: "82%", label: ` ${title} `,
      border: "line", tags: true, scrollable: true, alwaysScroll: true, keys: true, vi: true, mouse: true,
      padding: { left: 2, right: 2 }, style: modalStyle(),
      content: `${content}\n\n{${THEME.muted}-fg}${continueLabel}{/}`
    });
    box.setFront(); box.focus(); screen.render();
    let settled = false;
    const finish = (proceed: boolean) => {
      if (settled) return;
      settled = true; box.destroy(); screen.render(); resolve(proceed);
    };
    box.key(["enter"], () => finish(true));
    box.key(["escape", "q"], () => finish(false));
  });
}

function validPrice(value: string): string | undefined {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0.001 || price > 0.999) return "Use a price from 0.001 to 0.999.";
  if (Math.abs(price * 1000 - Math.round(price * 1000)) > 1e-8) return "Price must align to the 0.001 tick.";
  return undefined;
}

function validShares(value: string): string | undefined {
  const shares = Number(value);
  return Number.isFinite(shares) && shares >= 1 ? undefined : "Enter at least 1 share.";
}

function validLevelCount(value: string): string | undefined {
  const levels = Number(value);
  return Number.isInteger(levels) && levels >= 1 && levels <= 100 ? undefined : "Enter 1 to 100 levels.";
}

async function chooseOutcome(screen: Screen, market: Market): Promise<Outcome | undefined> {
  return choose(screen, "Outcome", market.outcomes.map((outcome) => ({
    label: `${outcome.title.padEnd(12)} ${(Number(outcome.currentPrice) / 10_000).toFixed(1)}¢`, value: outcome
  })));
}

function addAggregateBalanceErrors(
  checks: ReturnType<typeof validateDraft>[],
  account: { cash_balance: string; positions: Array<{ token_id: string; balance: string; reserved: string }> }
): void {
  const totalBuy = checks.filter((row) => row.draft.side === "BUY").reduce((sum, row) => sum + row.notional, 0n);
  if (totalBuy > BigInt(account.cash_balance)) checks.find((row) => row.draft.side === "BUY")?.errors.push("aggregate BUY collateral exceeds cash balance");
  const sellByToken = new Map<string, bigint>();
  for (const check of checks.filter((row) => row.draft.side === "SELL")) {
    try { sellByToken.set(check.draft.tokenId, (sellByToken.get(check.draft.tokenId) ?? 0n) + parseFixed6(check.draft.shares, "shares")); } catch { /* row already contains the error */ }
  }
  for (const [tokenId, shares] of sellByToken) {
    const position = account.positions.find((row) => row.token_id === tokenId);
    const free = position ? BigInt(position.balance) - BigInt(position.reserved) : 0n;
    if (shares > free) checks.find((row) => row.draft.side === "SELL" && row.draft.tokenId === tokenId)?.errors.push("aggregate ladder SELL exceeds free token balance");
  }
}

function draftTable(drafts: OrderDraft[], checks: ReturnType<typeof validateDraft>[], fees: Map<string, number>): string {
  const header = " #  OUTCOME   SIDE   PRICE       SHARES       NOTIONAL    FEE EST.   CHECK";
  const rows = drafts.map((draft, index) => {
    const notional = Number(draft.price) * Number(draft.shares);
    const check = checks[index]!;
    const status = check.errors.length ? `{${THEME.ask}-fg}${check.errors.join("; ")}{/}` : check.warnings.length ? `{${THEME.warning}-fg}${check.warnings.join("; ")}{/}` : `{${THEME.bid}-fg}ready{/}`;
    return `${String(index + 1).padStart(2)}  ${draft.outcome.slice(0, 8).padEnd(8)}  ${draft.side.padEnd(4)}  ${draft.price.padStart(6)}  ${draft.shares.padStart(11)}  ${`$${notional.toFixed(3)}`.padStart(12)}  ${`$${estimateFee(draft.shares, draft.price, fees.get(draft.tokenId) ?? 0)}`.padStart(9)}  ${status}`;
  });
  return `{bold}${header}{/bold}\n${rows.join("\n")}`;
}

async function reviewAndSend(screen: Screen, session: WalletSession, drafts: OrderDraft[]): Promise<void> {
  const publicClient = new PublicXoClient();
  const trading = new TradingClient(session);
  const tokenIds = [...new Set(drafts.map((draft) => draft.tokenId))];
  let books, positions, feeRates;
  try {
    [books, positions, feeRates] = await Promise.all([
      publicClient.getBooks(tokenIds), trading.getPositions(), Promise.all(tokenIds.map((tokenId) => publicClient.getFeeRateBps(tokenId)))
    ]);
  } catch (error) {
    await notice(screen, "Preflight failed", (error as Error).message);
    return;
  }
  const booksByToken = new Map(books.map((book) => [book.asset_id, book]));
  const feesByToken = new Map(tokenIds.map((tokenId, index) => [tokenId, feeRates[index] ?? 0]));
  const checks = drafts.map((draft) => validateDraft(draft, booksByToken.get(draft.tokenId), positions.positions));
  addAggregateBalanceErrors(checks, positions);
  const collateral = checks.filter((row) => row.draft.side === "BUY").reduce((sum, row) => sum + row.notional, 0n);
  const review = `${draftTable(drafts, checks, feesByToken)}\n\nBUY collateral $${formatFixed6(collateral)} · wallet cash $${formatFixed6(BigInt(positions.cash_balance))}`;
  const canSend = !checks.some((check) => check.errors.length);
  const proceed = await notice(screen, canSend ? "Review manual submission" : "Submission blocked", review, canSend ? "Enter to continue to exact confirmation · Esc to discard" : "Enter/Esc to return and fix the draft");
  if (!canSend || !proceed) return;
  const phrase = `SEND ${drafts.length}`;
  const typed = await ask(screen, "Final confirmation", `Type ${phrase} to submit once`, "");
  if (typed !== phrase) { await notice(screen, "Discarded", "The exact confirmation did not match. Nothing was sent."); return; }
  try {
    const [fresh, freshPositions] = await Promise.all([publicClient.getBooks(tokenIds), trading.getPositions()]);
    const freshByToken = new Map(fresh.map((book) => [book.asset_id, book]));
    const finalChecks = drafts.map((draft) => validateDraft(draft, freshByToken.get(draft.tokenId), freshPositions.positions));
    addAggregateBalanceErrors(finalChecks, freshPositions);
    if (finalChecks.some((check) => check.errors.length)) {
      await notice(screen, "Not sent", `The live book changed after confirmation.\n\n${finalChecks.flatMap((check) => check.errors).join("\n")}`);
      return;
    }
    const results = await trading.placeDrafts(drafts);
    await notice(screen, "XO submission response", conciseJson(results));
  } catch (error) {
    await notice(screen, "Unknown submission state", `${(error as Error).message}\n\nThe client did not retry. Inspect Open Orders before sending again.`);
  }
}

function conciseJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  return text.length > 8_000 ? `${text.slice(0, 8_000)}\n…` : text;
}

export async function runTradeOverlay(screen: Screen, market: Market, session: WalletSession): Promise<void> {
  const outcome = await chooseOutcome(screen, market);
  if (!outcome) return;
  const side = await choose<Side>(screen, "Side", [{ label: "BUY", value: "BUY" }, { label: "SELL", value: "SELL" }]);
  if (!side) return;
  const price = await ask(screen, "Limit price", "Price from 0.001 to 0.999", (Number(outcome.currentPrice) / 1_000_000).toFixed(3), validPrice);
  if (!price) return;
  const shares = await ask(screen, "Shares", "Number of shares", "10", validShares);
  if (!shares) return;
  const timeInForce = await choose<TimeInForce>(screen, "Time in force", [
    { label: "GTC · rests until canceled", value: "GTC" },
    { label: "GTD · expires at a set time", value: "GTD" },
    { label: "FAK · immediate partial fill; remainder killed", value: "FAK" },
    { label: "FOK · immediate all-or-nothing", value: "FOK" }
  ]);
  if (!timeInForce) return;
  const postOnly = ["GTC", "GTD"].includes(timeInForce)
    ? await choose<boolean>(screen, "Post only", [{ label: "Yes · maker only", value: true }, { label: "No", value: false }])
    : false;
  if (postOnly === undefined) return;
  let expiration: number | undefined;
  if (timeInForce === "GTD") {
    const minutes = await ask(screen, "Expiry", "Minutes until expiration", "60", (value) => Number(value) >= 1 ? undefined : "Enter at least one minute.");
    if (!minutes) return;
    expiration = Math.floor(Date.now() / 1000 + Number(minutes) * 60);
  }
  await reviewAndSend(screen, session, [{
    id: draftId(), conditionId: market.conditionId, marketTitle: market.title, tokenId: outcome.outcomeTokenId,
    outcome: outcome.title, side, price: Number(price).toFixed(3), shares, timeInForce, postOnly, ...(expiration ? { expiration } : {})
  }]);
}

export async function runLadderOverlay(screen: Screen, market: Market, session: WalletSession): Promise<void> {
  const outcome = await chooseOutcome(screen, market);
  if (!outcome) return;
  const side = await choose<Side>(screen, "Ladder side", [{ label: "BUY", value: "BUY" }, { label: "SELL", value: "SELL" }]);
  if (!side) return;
  const reference = (Number(outcome.currentPrice) / 1_000_000).toFixed(3);
  const start = await ask(screen, "Ladder start", "First price", reference, validPrice);
  if (!start) return;
  const end = await ask(screen, "Ladder end", "Last price", start, validPrice);
  if (!end) return;
  const levelText = await ask(screen, "Ladder levels", "Number of levels (1–100)", "3", validLevelCount);
  if (!levelText) return;
  const shares = await ask(screen, "Shares", "Shares per level", "10", validShares);
  if (!shares) return;
  const timeInForce = await choose<"GTC" | "GTD">(screen, "Resting order type", [{ label: "GTC", value: "GTC" }, { label: "GTD", value: "GTD" }]);
  if (!timeInForce) return;
  const postOnly = await choose<boolean>(screen, "Post only", [{ label: "Yes · maker only", value: true }, { label: "No", value: false }]);
  if (postOnly === undefined) return;
  let expiration: number | undefined;
  if (timeInForce === "GTD") {
    const minutes = await ask(screen, "Expiry", "Minutes until expiration", "60", (value) => Number(value) >= 1 ? undefined : "Enter at least one minute.");
    if (!minutes) return;
    expiration = Math.floor(Date.now() / 1000 + Number(minutes) * 60);
  }
  const base: Omit<OrderDraft, "id" | "price"> = {
    conditionId: market.conditionId, marketTitle: market.title, tokenId: outcome.outcomeTokenId,
    outcome: outcome.title, side, shares, timeInForce, postOnly, ...(expiration ? { expiration } : {})
  };
  const drafts = buildLadder({ base, startPrice: Number(start), endPrice: Number(end), levels: Number(levelText) });
  await reviewAndSend(screen, session, drafts);
}

function orderHash(order: OpenOrder): string | undefined { return order.order_hash ?? order.id; }

function accountAmount(raw: string): string {
  try { return formatFixed6(BigInt(raw)); }
  catch { return raw; }
}

function profileEnd(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "end unknown";
  return new Date(Date.parse(value)).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).replace(",", "");
}

function activePosition(position: Position): boolean {
  try { return BigInt(position.balance) > 0n || BigInt(position.reserved) > 0n; }
  catch { return Number(position.balance) > 0 || Number(position.reserved) > 0; }
}

type ProfileAction = { type: "close" } | { type: "refresh" } | { type: "cancel"; hashes: string[] };

export async function runProfileOverlay(screen: Screen, session: WalletSession): Promise<void> {
  const trading = new TradingClient(session);
  const publicClient = new PublicXoClient();
  for (;;) {
    const [positionsResult, ordersResult] = await Promise.allSettled([trading.getPositions(), trading.getOpenOrders()]);
    const positions = positionsResult.status === "fulfilled"
      ? positionsResult.value.positions.filter(activePosition)
      : [];
    const cash = positionsResult.status === "fulfilled" ? accountAmount(positionsResult.value.cash_balance) : "unavailable";
    const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];
    const tokenIds = [...new Set([...positions.map((position) => position.token_id), ...orders.map((order) => order.asset_id)].filter(Boolean))];
    let markets: Market[] = [];
    let marketError = "";
    try { markets = await publicClient.findActiveMarketsByTokenIds(tokenIds); }
    catch (error) { marketError = (error as Error).message; }

    const tokenContext = new Map<string, { market: Market; outcome: Outcome }>();
    for (const market of markets) {
      for (const outcome of market.outcomes) tokenContext.set(outcome.outcomeTokenId, { market, outcome });
    }
    const activeMarkets = new Map(markets.map((market) => [market.conditionId, market]));
    const selected = new Set<number>();
    const orderRows = new Map<number, number>();

    const buildItems = (): string[] => {
      orderRows.clear();
      const items: string[] = [
        `{bold}{${THEME.yes}-fg}MY PROFILE{/}  cash $${cash} · ${activeMarkets.size} active market${activeMarkets.size === 1 ? "" : "s"} · ${positions.length} token position${positions.length === 1 ? "" : "s"} · ${orders.length} open order${orders.length === 1 ? "" : "s"}{/bold}`,
        ""
      ];
      if (positionsResult.status === "rejected") items.push(`{${THEME.ask}-fg}Positions unavailable: ${positionsResult.reason instanceof Error ? positionsResult.reason.message : String(positionsResult.reason)}{/}`);
      if (marketError) items.push(`{${THEME.warning}-fg}Market names incomplete: ${marketError}{/}`);
      items.push(`{bold}OPEN ORDERS  {${THEME.muted}-fg}Space select · C cancel selected{/}{/bold}`);
      if (ordersResult.status === "rejected") items.push(`{${THEME.ask}-fg}Orders unavailable: ${ordersResult.reason instanceof Error ? ordersResult.reason.message : String(ordersResult.reason)}{/}`);
      if (!orders.length && ordersResult.status === "fulfilled") items.push(`  {${THEME.muted}-fg}No open orders.{/}`);
      orders.forEach((order, orderIndex) => {
        const context = tokenContext.get(order.asset_id);
        const remaining = Math.max(0, Number(order.original_size) - Number(order.size_matched));
        const row = items.length;
        orderRows.set(row, orderIndex);
        items.push(`${selected.has(orderIndex) ? "[x]" : "[ ]"} ${(context?.market.title ?? order.market ?? "market").slice(0, 38).padEnd(38)} ${(context?.outcome.title ?? order.outcome ?? "token").slice(0, 9).padEnd(9)} ${order.side.padEnd(4)} @ ${order.price.padStart(6)} · open ${String(remaining).padStart(9)} · ${order.status}`);
      });
      items.push("");
      items.push(`{bold}ACTIVE MARKETS{/bold}`);
      if (!activeMarkets.size) items.push(`  {${THEME.muted}-fg}No active XO market could be matched to the current positions or orders.{/}`);
      for (const market of activeMarkets.values()) {
        const marketPositions = positions.filter((position) => tokenContext.get(position.token_id)?.market.conditionId === market.conditionId);
        const marketOrders = orders.filter((order) => tokenContext.get(order.asset_id)?.market.conditionId === market.conditionId);
        items.push(`  {bold}${market.title.slice(0, 68)}{/bold}  {${THEME.muted}-fg}${profileEnd(market.expiresAt)} · ${marketOrders.length} order${marketOrders.length === 1 ? "" : "s"}{/}`);
        for (const position of marketPositions) {
          const outcome = tokenContext.get(position.token_id)?.outcome;
          let free = "—";
          try { free = accountAmount((BigInt(position.balance) - BigInt(position.reserved)).toString()); } catch { /* Preserve display if XO changes units. */ }
          items.push(`    ${(outcome?.title ?? "token").slice(0, 12).padEnd(12)} balance ${accountAmount(position.balance).padStart(12)} · reserved ${accountAmount(position.reserved).padStart(12)} · free ${free.padStart(12)} · ${outcome ? (Number(outcome.currentPrice) / 10_000).toFixed(1) + "¢" : "price —"}`);
        }
      }
      const unresolved = positions.filter((position) => !tokenContext.has(position.token_id));
      if (unresolved.length) items.push(`  {${THEME.muted}-fg}${unresolved.length} non-active or unmatched token position${unresolved.length === 1 ? "" : "s"} omitted from this active-market view.{/}`);
      return items;
    };

    const list = blessed.list({
      parent: screen, top: "center", left: "center", width: "96%", height: "90%",
      label: " My Profile · Space selects an order · C cancels · R refreshes · M/Esc closes ",
      border: "line", tags: true, keys: true, vi: true, mouse: true, alwaysScroll: true,
      scrollbar: { ch: "▌", style: { bg: THEME.yes } }, padding: { left: 1, right: 1 }, style: modalStyle()
    });
    const renderItems = (): void => {
      const index = Math.max(0, selectedIndex(list));
      const items = buildItems();
      list.setItems(items);
      list.select(Math.min(index, Math.max(0, items.length - 1)));
      screen.render();
    };
    list.setFront(); renderItems(); list.focus();
    const action = await new Promise<ProfileAction>((resolve) => {
      let settled = false;
      const finish = (value: ProfileAction): void => {
        if (settled) return;
        settled = true; list.destroy(); screen.render(); resolve(value);
      };
      list.key(["space"], () => {
        const orderIndex = orderRows.get(selectedIndex(list));
        if (orderIndex === undefined) return;
        if (selected.has(orderIndex)) selected.delete(orderIndex); else selected.add(orderIndex);
        renderItems();
      });
      list.key(["c"], () => finish({
        type: "cancel",
        hashes: [...selected].flatMap((index) => {
          const order = orders[index];
          const hash = order ? orderHash(order) : undefined;
          return hash ? [hash] : [];
        })
      }));
      list.key(["r"], () => finish({ type: "refresh" }));
      list.key(["m", "escape", "q"], () => finish({ type: "close" }));
    });
    if (action.type === "close") return;
    if (action.type === "refresh") continue;
    if (!action.hashes.length) {
      await notice(screen, "No orders selected", "Select one or more order rows with Space before pressing C.");
      continue;
    }
    const phrase = `CANCEL ${action.hashes.length}`;
    const typed = await ask(screen, "Cancel confirmation", `Type ${phrase}`, "");
    if (typed !== phrase) {
      await notice(screen, "Discarded", "Nothing was canceled.");
      continue;
    }
    try { await notice(screen, "XO cancellation response", conciseJson(await trading.cancel(action.hashes))); }
    catch (error) { await notice(screen, "Unknown cancellation state", `${(error as Error).message}\n\nThe client did not retry. The profile will refresh to reconcile.`); }
  }
}

export async function runOrdersOverlay(screen: Screen, session: WalletSession): Promise<void> {
  const client = new TradingClient(session);
  let orders: OpenOrder[];
  try { orders = await client.getOpenOrders(); }
  catch (error) { await notice(screen, "Open orders failed", (error as Error).message); return; }
  if (!orders.length) { await notice(screen, "Open orders", "No open orders."); return; }
  const selected = new Set<number>();
  const list = blessed.list({
    parent: screen, top: "center", left: "center", width: "94%", height: "86%", label: " Open orders · Space selects · C cancels · Esc returns ",
    border: "line", tags: true, keys: true, vi: true, mouse: true, padding: { left: 1, right: 1 }, style: modalStyle()
  });
  const renderItems = () => {
    const index = Math.max(0, selectedIndex(list));
    list.setItems(orders.map((order, row) => `${selected.has(row) ? "[x]" : "[ ]"} ${(order.outcome ?? "token").slice(0, 9).padEnd(9)} ${order.side.padEnd(4)} @ ${order.price.padStart(6)}  original ${order.original_size.padStart(9)}  matched ${order.size_matched.padStart(9)}  ${order.status}`));
    list.select(index); screen.render();
  };
  list.setFront(); renderItems(); list.focus();
  const hashes = await new Promise<string[] | undefined>((resolve) => {
    let settled = false;
    const finish = (value?: string[]) => { if (settled) return; settled = true; list.destroy(); screen.render(); resolve(value); };
    list.key(["space"], () => { const index = selectedIndex(list); if (selected.has(index)) selected.delete(index); else selected.add(index); renderItems(); });
    list.key(["c"], () => finish([...selected].flatMap((index) => { const order = orders[index]; const hash = order ? orderHash(order) : undefined; return hash ? [hash] : []; })));
    list.key(["escape", "q"], () => finish());
  });
  if (!hashes?.length) return;
  const phrase = `CANCEL ${hashes.length}`;
  const typed = await ask(screen, "Cancel confirmation", `Type ${phrase}`, "");
  if (typed !== phrase) { await notice(screen, "Discarded", "Nothing was canceled."); return; }
  try { await notice(screen, "XO cancellation response", conciseJson(await client.cancel(hashes))); }
  catch (error) { await notice(screen, "Unknown cancellation state", `${(error as Error).message}\n\nRefresh Open Orders to reconcile. The client did not retry.`); }
}

export async function runReadOnlyNotice(screen: Screen): Promise<void> {
  await notice(screen, "Wallet required", "This session is read-only. Press W to enter a temporary wallet session. For persistent local setup, quit and run `npm run setup` from source or `xo-tui setup` from an installed package. Never commit the completed .env.");
}
