export const XO = {
  dataApi: "https://api-mainnet.xo.market/api",
  orderbookApi: "https://orderbooks.xo.market",
  chainId: 3223,
  // Current production deployment used by the live CLOB signing domain.
  // Kept in one public, non-secret location so releases can update it safely.
  ctfExchange: "0x4bC5E872256D12E6017dfe466E04c867DC761B77",
  zeroAddress: "0x0000000000000000000000000000000000000000",
  signatureType: 3 as const,
  tickSize: 0.001,
  micro: 1_000_000n
} as const;

export const THEME = {
  // XO pink/violet on a dense charcoal terminal canvas.
  bg: "#111015",
  panel: "#19171e",
  panelAlt: "#211d27",
  border: "#675e70",
  text: "#f3edf1",
  muted: "#a59aa4",
  yes: "#ff7fa7",
  yesText: "#210d15",
  no: "#8f7cff",
  noText: "#f7f3ff",
  bid: "#64d6a0",
  ask: "#ff7094",
  accent: "#ff87a6",
  focus: "#4b2a39",
  warning: "#f2bd63"
} as const;
