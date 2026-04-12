import type { NormalizedEventSource } from "../core/types.js";

export type MarketFeedMode = "live" | "simulate";

export type AppConfig = {
  mode: MarketFeedMode;
  eventSource: NormalizedEventSource;
  wsUrl: string;
  redisHost: string;
  redisPort: number;
  redisPassword: string;
  channels: string[];
  subscribePayload?: string;
  apiPort: number;
  heartbeatIntervalMs: number;
  reconnectDelayMs: number;
  /** simulate: symbols to emit (comma-separated) */
  simSymbols: string[];
  /** simulate: ms between ticks (each tick emits one symbol, rotating) */
  simTickIntervalMs: number;
  /** simulate: max absolute price change per tick (random walk step) */
  simPriceStep: number;
  /** simulate: optional "SYM:base,SYM2:base2" base prices; missing symbols use a deterministic hash */
  simBasePrices: Map<string, number>;
};

function parseMode(raw: string | undefined): MarketFeedMode {
  const v = (raw ?? "live").toLowerCase();
  return v === "simulate" ? "simulate" : "live";
}

function parseSimSymbols(raw: string | undefined): string[] {
  return (raw ?? "SSI,VND,VCB")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/** Parse SIM_BASE_PRICES like "SSI:24.5,VND:12.3" */
function parseSimBasePrices(raw: string | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!raw?.trim()) return map;
  for (const part of raw.split(",")) {
    const [sym, num] = part.split(":").map((x) => x.trim());
    if (!sym || num === undefined) continue;
    const n = Number(num);
    if (!Number.isNaN(n) && n > 0) {
      map.set(sym.toUpperCase(), n);
    }
  }
  return map;
}

function stableBasePrice(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    h = (h * 31 + symbol.charCodeAt(i)) | 0;
  }
  const abs = Math.abs(h);
  return 10 + (abs % 9000) / 100;
}

export function loadConfig(): AppConfig {
  const mode = parseMode(process.env.MARKET_FEED_MODE);
  const channels = (process.env.FASTCONNECT_CHANNELS ?? "X,R,MI,F,B")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const simSymbols = parseSimSymbols(process.env.SIM_SYMBOLS);
  const simBasePrices = parseSimBasePrices(process.env.SIM_BASE_PRICES);
  const eventSource: NormalizedEventSource =
    mode === "simulate" ? "ssi-fastconnect-sim" : "ssi-fastconnect";

  return {
    mode,
    eventSource,
    wsUrl: process.env.FASTCONNECT_WS_URL ?? "wss://fc-datahub.ssi.com.vn/v2.0",
    redisHost: process.env.REDIS_HOST ?? "localhost",
    redisPort: Number(process.env.REDIS_PORT ?? 6379),
    redisPassword: process.env.REDIS_PASSWORD ?? "",
    channels,
    subscribePayload: process.env.FASTCONNECT_SUBSCRIBE_PAYLOAD,
    apiPort: Number(process.env.MARKET_FEED_PORT ?? process.env.PORT ?? 8100),
    heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS ?? 1000),
    reconnectDelayMs: Number(process.env.FASTCONNECT_RECONNECT_MS ?? 2000),
    simSymbols,
    simTickIntervalMs: Number(process.env.SIM_TICK_INTERVAL_MS ?? 500),
    simPriceStep: Number(process.env.SIM_PRICE_STEP ?? 0.05),
    simBasePrices
  };
}

/** Resolve initial price for a symbol (explicit map or stable hash). */
export function resolveSimBasePrice(symbol: string, config: AppConfig): number {
  const fromEnv = config.simBasePrices.get(symbol);
  if (fromEnv !== undefined) return fromEnv;
  return stableBasePrice(symbol);
}
