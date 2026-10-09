# Architecture and trust boundaries

## Read-only path

1. XO Data API supplies active categories, event descriptions, and groups all related binary outcome markets. A category view uses XO's `categoryId` filter. The `ALL` view samples each active category before sorting by recency so one high-volume category cannot monopolize discovery. Convictions use XO's separate `/convictions` feed and are adapted into the same event/market presentation, while preserving their live condition and outcome token IDs for books and manual trading.
2. Opening the order-book workspace fetches initial L2 snapshots for every token in the selected event.
3. XO's public market WebSocket then supplies full-book snapshots and incremental changes for those tokens.
4. Closing the workspace closes the socket; the display marks connection state and reconnects with bounded backoff while open.

WebSocket events only update an in-memory book. There is no code path from a WebSocket handler to a trading method.

## Manual mutation path

1. User creates a local ticket or ladder.
2. Pure validation checks ticks, size, post-only crossing, inventory, cash, and estimated fees.
3. User selects the rows to send.
4. User types `SEND N`.
5. Client fetches fresh books and repeats validation.
6. Client signs and submits the batch exactly once.

Every step after startup is rendered as a Blessed panel over the persistent dashboard. The interface does not tear down into ordinary terminal prompts for trading, ladders, review, results, or cancellation.

Cancellation similarly requires selecting orders and typing `CANCEL N`. A network failure is treated as unknown state and must be reconciled manually.

## Secret boundary

Credentials enter through hidden prompts or process environment. They are held in a `WalletSession` object for the current process only. No logger, state file, analytics call, crash dump helper, or persistence adapter receives that object.

## Deployment constants

Chain and contract identifiers are public configuration, not credentials. They are centralized in `src/constants.ts`. Before a release, compare them with XO's current production documentation and test using a disposable small order.
