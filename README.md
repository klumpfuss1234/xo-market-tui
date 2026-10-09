# XO Market TUI

A public, manual-first terminal client for [XO](https://beta.xo.market/). It uses a dense charcoal trading-terminal canvas with XO pink and violet accents, browses whole events rather than isolated binaries, and lets a connected user prepare, review, submit, and cancel orders.

The repository contains **no wallet, API key, cookie, captured request, browser profile, or market-specific automation**. A user may supply their own credentials through a git-ignored local `.env` or hidden, memory-only prompts.

## What it does

- Browse a deliberately mixed `ALL` market feed or press `C` to switch to XO's separate live `CONVICTIONS` feed or any market category (Crypto, Finance, Politics, Sports, Tech, and the rest). Category filtering uses the complete event catalog instead of presenting XO's sports-heavy first API page as “all events.”
- Page or search XO events, see each event's ending time directly in the overview, then inspect every related outcome market together (including multi-outcome events such as home/draw/away).
- Read the event description, selected binary-market description, resolution rules, status, exact end time, time remaining, market/event volume, and indicative gross return for YES and NO in one view. Return is shown per winning share and as ROI from the displayed current price, explicitly before fees and possible execution slippage.
- Press `O` to expand an in-place order-book workspace without leaving the event browser. The event list remains visible, related outcomes stay selectable, and side-by-side YES/NO ladders show price, shares, total, best bid/ask, spread, midpoint, and last trade. It subscribes every outcome token in that event to `wss://orderbooks.xo.market/ws/market` and closes the socket when you leave the workspace.
- Move left/right through categories like terminal tabs, use `/` for a catalog-wide API search, or use `F` for an instant local filter of the already loaded page.
- Cache category/search pages in memory so returning to a view is immediate and a transient refresh failure keeps a consistent usable page on screen.
- Press `?` for an in-TUI help panel; navigation documentation never requires leaving the terminal.
- Recover with an initial REST snapshot and visible WebSocket reconnect/stale state.
- Create manual BUY or SELL tickets using GTC, GTD, FAK, or FOK.
- Build a price ladder from a start price, end price, level count, and shares per level, then review every row before submission.
- Keep trade tickets, ladder construction, preflight review, exact confirmation, submission results, and order cancellation inside modal TUI panels; the dashboard is not destroyed between steps.
- Preview notional, fee estimate, cash/position availability, minimum size, tick alignment, and post-only crossing risk.
- Submit exactly once after typing `SEND N`; mutations are never retried automatically.
- Inspect and cancel selected open orders after typing `CANCEL N`.
- Press `M` for My Profile: wallet cash, active markets, nonzero outcome positions, and open orders with manual multi-select cancellation in one view.

## What it deliberately does not do

- No auto quoting, repricing, reranking, market making, mirroring, signal following, timers, or trade loops.
- No automatic split/merge/redeem transactions.
- No private key or API credential storage.
- No browser-cookie, Privy-session, or captured-request reuse.
- No automatic retry after an uncertain submit or cancel result.

## Install

```bash
git clone https://github.com/klumpfuss1234/xo-market-tui.git
cd xo-tui
npm install
npm run check
npm run build
npm start
```

On the first start, the TUI detects that no wallet is configured and offers three safe choices: continue read-only, enter credentials for this process only, or show the `.env` setup guide. Read-only mode includes all market browsing and live WebSocket books.

To always skip the wallet question:

```bash
npm start -- --read-only
```

Development mode:

```bash
npm run dev
```

After the package is published, a global installation can be launched from any working directory:

```bash
npm install --global xo-market-tui
xo-tui
```

For an installed package, run `xo-tui setup` for a complete copy/paste `.env` template. The client reads `.env` from the directory in which `xo-tui` is launched; it does not expect documentation or a template file to exist there.

Read-only mode needs no wallet. Run a connectivity check with:

```bash
npm run build
node dist/cli.js doctor
```

## Keyboard controls

| Key | Action |
| --- | --- |
| `↑` / `↓`, `j` / `k` | Select event or related outcome |
| `Tab` / `Enter` | Move between the event list and outcome list |
| `←` / `→` | Move directly to the previous/next XO feed or category |
| `c` | Open the in-TUI Markets, Convictions, and category browser |
| `o` / `Esc` | Open/close the live order-book workspace |
| `/` | Search the complete XO event catalog |
| `f` | Locally filter the currently loaded event page |
| `PgUp` / `PgDn` | Previous/next event page |
| `r` | Refresh event page |
| `t` | In-TUI manual trade ticket |
| `l` | In-TUI manual ladder builder |
| `m` | My Profile: active markets, positions, and order cancellation |
| `p` | In-TUI open orders and manual cancel |
| `w` | Start a temporary wallet session |
| `?` | Open the in-TUI help panel |
| `q` | Quit |

## Wallet setup

Read [Wallet setup](docs/WALLET_SETUP.md) before enabling trading. The shortest safe path is:

1. Create and fund an XO smart account through XO.
2. Complete XO's CTF Exchange approvals in the official app.
3. Create or derive your own XO CLOB API-key triplet through XO's documented authentication flow.
4. Choose one credential mode:
   - **Temporary:** run `npm start -- --wallet` and use the hidden prompts. Nothing is written.
   - **Local `.env`:** run `cp .env.example .env && chmod 600 .env`, fill your own five values, then run `npm start`.
5. Review each order locally and type the exact confirmation phrase.
6. Quit when done. A temporary session is discarded; delete `.env` when persistent local access is no longer wanted.

Run `npm run setup` from a source checkout—or `xo-tui setup` from an installed package—to print the setup checklist without asking for or displaying credentials. The TUI automatically loads only `.env` in the directory from which it is started. A real `.env` is git-ignored and never included in the npm package; only the blank `.env.example` template is packaged.

## Public repository safety

- `.env.example` contains names and blank placeholders only.
- `.env`, private keys, credential exports, sessions, and logs are git-ignored.
- The application never writes credentials to disk and never prints them.
- `npm run scan-secrets` rejects common embedded key and secret shapes.
- The private preview launcher used by the repository maintainer lives outside this repository and is not part of the public package.

## Live-order safety model

The order draft is local until the final confirmation. Immediately after confirmation, the client fetches a fresh order book and aborts if a post-only order would cross or another validation fails. The batch is then sent once. If the network response is uncertain, the client tells you to reconcile in Open Orders; it does not retry.

WebSocket messages only update the dedicated order-book display. They can never submit, cancel, or modify an order.

## Public-release checklist

```bash
npm run scan-secrets
npm run check
npm pack --dry-run
git status --short
```

Review [Security](SECURITY.md) before publishing. XO APIs and contracts can change; verify the chain ID, exchange deployment, auth headers, and order schema against the current official XO documentation before each release.

## Disclaimer

This is independent community software, not an official XO client. Prediction-market trading can lose money. Use small test orders first and verify every transaction and order response yourself.
