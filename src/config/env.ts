import type { NormalizedEventSource } from "../core/types.js";

export type MarketFeedMode = "live" | "simulate";

const DEFAULT_SIGNALR_CHANNEL_SPEC: Record<string, string> = {
  X: "X-QUOTE:ALL",
  R: "R-QUOTE:ALL",
  MI: "MI-INDEX:ALL",
  F: "F-QUOTE:ALL",
  B: "B-QUOTE:ALL"
};

function resolveSignalRBases(wsUrlRaw: string | undefined): { wss: string; https: string } {
  const trimmed = (wsUrlRaw ?? "wss://fc-datahub.ssi.com.vn/v2.0").trim().replace(/\/+$/, "");
  const withSignalr = trimmed.toLowerCase().includes("/signalr")
    ? trimmed
    : `${trimmed}/signalr`;
  const wss = withSignalr.startsWith("wss://")
    ? withSignalr
    : withSignalr.replace(/^https:\/\//i, "wss://");
  const https = wss.replace(/^wss:\/\//i, "https://");
  return { wss, https };
}

function toSignalrChannelSpec(token: string): string {
  const t = token.trim();
  if (t === "") {
    return t;
  }
  if (t.includes(":")) {
    return t;
  }
  const key = t.toUpperCase();
  return DEFAULT_SIGNALR_CHANNEL_SPEC[key] ?? `${key}-QUOTE:ALL`;
}

function resolveSignalrChannelSpecs(): string[] {
  const override = process.env.FASTCONNECT_SIGNALR_CHANNELS?.trim();
  if (override) {
    return override
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return (process.env.FASTCONNECT_CHANNELS ?? "X,R,MI,F,B")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map(toSignalrChannelSpec);
}

export type AppConfig = {
  mode: MarketFeedMode;
  eventSource: NormalizedEventSource;
  /** Legacy display / logging; SignalR uses `signalRWssBase`. */
  wsUrl: string;
  signalRWssBase: string;
  signalRHttpsBase: string;
  fastconnectApiBaseUrl: string;
  consumerId: string;
  consumerSecret: string;
  signalrChannelSpecs: string[];
  tokenRefreshLeadMs: number;
  httpRequestTimeoutMs: number;
  accessTokenDefaultTtlSec: number;
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
  /** simulate: baseline volume used for RType B mock bars */
  simVolumeBase: number;
  /** simulate: incremental volume delta used for RType B mock bars */
  simVolumeStep: number;
};

function parseMode(raw: string | undefined): MarketFeedMode {
  const v = (raw ?? "live").trim().toLowerCase();
  if (v === "" || v === "live") {
    return "live";
  }
  // Common aliases so simulate mode is picked up even with short env values
  if (["simulate", "sim", "mock", "dev"].includes(v)) {
    return "simulate";
  }
  return "live";
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

  const wsUrl = process.env.FASTCONNECT_WS_URL ?? "wss://fc-datahub.ssi.com.vn/v2.0";
  const { wss: signalRWssBase, https: signalRHttpsBase } = resolveSignalRBases(wsUrl);
  const fastconnectApiBaseUrl = (
    process.env.FASTCONNECT_API_URL ?? "https://fc-data.ssi.com.vn"
  ).replace(/\/+$/, "");
  const consumerId = (process.env.CONSUMER_ID ?? "").trim();
  const consumerSecret = (process.env.CONSUMER_SECRET ?? "").trim();
  const signalrChannelSpecs = resolveSignalrChannelSpecs();

  if (mode === "live") {
    if (!consumerId || !consumerSecret) {
      throw new Error(
        "MARKET_FEED_MODE=live requires CONSUMER_ID and CONSUMER_SECRET for SSI AccessToken + SignalR"
      );
    }
    if (signalrChannelSpecs.length === 0) {
      throw new Error("At least one SignalR channel is required (FASTCONNECT_CHANNELS or FASTCONNECT_SIGNALR_CHANNELS)");
    }
  }

  return {
    mode,
    eventSource,
    wsUrl,
    signalRWssBase,
    signalRHttpsBase,
    fastconnectApiBaseUrl,
    consumerId,
    consumerSecret,
    signalrChannelSpecs,
    tokenRefreshLeadMs: Number(process.env.FASTCONNECT_TOKEN_REFRESH_LEAD_MS ?? 300_000),
    httpRequestTimeoutMs: Number(process.env.FASTCONNECT_HTTP_TIMEOUT_MS ?? 15_000),
    accessTokenDefaultTtlSec: Number(process.env.FASTCONNECT_TOKEN_DEFAULT_TTL_SEC ?? 28_800),
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
    simBasePrices,
    simVolumeBase: Number(process.env.SIM_VOLUME_BASE ?? 5000),
    simVolumeStep: Number(process.env.SIM_VOLUME_STEP ?? 250)
  };
}

/** Resolve initial price for a symbol (explicit map or stable hash). */
export function resolveSimBasePrice(symbol: string, config: AppConfig): number {
  const fromEnv = config.simBasePrices.get(symbol);
  if (fromEnv !== undefined) return fromEnv;
  return stableBasePrice(symbol);
}
