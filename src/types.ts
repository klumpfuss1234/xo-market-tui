export interface Category {
  id: number;
  name: string;
  slug?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface Outcome {
  id: number;
  title: string;
  outcomeTokenId: string;
  currentPrice: string;
  volumeTradedInUSD?: string;
  index: number;
}

export interface Market {
  id: number;
  conditionId: string;
  title: string;
  slug: string;
  description?: string | null;
  type?: number | null;
  rules?: Record<string, unknown> | null;
  categoryPath?: Category[];
  tags?: string[];
  startsAt?: string | null;
  expiresAt?: string | null;
  status: string;
  totalVolumeInUSD?: string;
  imageUrl?: string | null;
  resolutionSources?: string[];
  outcomes: Outcome[];
}

export interface MarketPage {
  data: Market[];
  meta: {
    page: number;
    take: number;
    itemCount: number;
    pageCount: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
}

export interface EventSummary {
  id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  category?: Category | null;
  type?: string | null;
  marketCount: number;
  directMarketCount?: number;
  subEventCount?: number;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown> | null;
  catalogSurface?: "MARKETS" | "CONVICTIONS";
}

export interface EventMarket {
  eventId: string;
  eventSortOrder?: number;
  groupTitle?: string | null;
  market: Market;
}

export interface XoEvent extends EventSummary {
  markets: EventMarket[];
  subEvents?: XoEvent[];
}

export interface EventPage {
  data: EventSummary[];
  meta: MarketPage["meta"];
}

export interface ConvictionSummary {
  id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  categoryId?: number | null;
  type?: number | null;
  graduatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  market: Market;
}

export interface ConvictionPage {
  data: ConvictionSummary[];
  meta: MarketPage["meta"];
}

export interface PriceLevel { price: string; size: string }

export interface OrderBook {
  market: string;
  asset_id: string;
  timestamp: string;
  hash: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  min_order_size: string;
  tick_size: string;
  last_trade_price: string;
}

export type Side = "BUY" | "SELL";
export type TimeInForce = "GTC" | "GTD" | "FAK" | "FOK";

export interface OrderDraft {
  id: string;
  conditionId: string;
  marketTitle: string;
  tokenId: string;
  outcome: string;
  side: Side;
  price: string;
  shares: string;
  timeInForce: TimeInForce;
  postOnly: boolean;
  expiration?: number;
}

export interface OpenOrder {
  id?: string;
  order_hash?: string;
  market: string;
  asset_id: string;
  outcome?: string;
  side: Side;
  price: string;
  original_size: string;
  size_matched: string;
  status: string;
  created_at?: number;
  order_type?: TimeInForce;
}

export interface Position {
  token_id: string;
  balance: string;
  reserved: string;
}

export interface WalletSession {
  smartAccount: string;
  ownerPrivateKey: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  hmacMode: "path-only" | "path-with-query";
}
