import type {
  FastConnectPayload,
  ForeignTransactionSnapshot,
  NormalizedEvent,
  NormalizedEventSource,
  NormalizedOhlcv
} from "../core/types.js";

const TRADING_TIMEZONE = "Asia/Ho_Chi_Minh";

export class EventNormalizer {
  private seq = 0;

  constructor(private readonly eventSource: NormalizedEventSource = "ssi-fastconnect") {}

  nextDelta(payload: FastConnectPayload): NormalizedEvent | null {
    const normalizedPayload = unwrapPayload(payload);
    const channel = resolveChannel(normalizedPayload);
    if (channel === "R") {
      return null;
    }
    const symbol = String(normalizedPayload.Symbol ?? normalizedPayload.symbol ?? "").toUpperCase();
    if (!symbol) {
      return null;
    }

    const priceRaw = normalizedPayload.LastVal ?? normalizedPayload.Close ?? normalizedPayload.price ?? 0;
    const price = Number(priceRaw);
    if (Number.isNaN(price)) {
      return null;
    }

    this.seq += 1;
    const event: NormalizedEvent = {
      symbol,
      price,
      ts: new Date().toISOString(),
      seq: this.seq,
      source: this.eventSource,
      isHeartbeat: false,
      marketStatus: String(
        normalizedPayload.TradingSession ?? normalizedPayload.marketStatus ?? "UNKNOWN"
      ),
      channel
    };

    const ohlcv = normalizeOhlcv(normalizedPayload, channel);
    if (ohlcv) {
      event.barTs = ohlcv.tickTime;
      event.ohlcv = ohlcv;
    }

    return event;
  }

  nextForeignTransaction(payload: FastConnectPayload): ForeignTransactionSnapshot | null {
    const normalizedPayload = unwrapPayload(payload);
    const channel = resolveChannel(normalizedPayload);
    if (channel !== "R") {
      return null;
    }

    const symbol = String(normalizedPayload.Symbol ?? normalizedPayload.symbol ?? "").trim().toUpperCase();
    if (symbol === "") {
      return null;
    }

    const tradeDate = normalizeTradingDate(normalizedPayload.TradingDate ?? normalizedPayload.tradeDate);
    if (!tradeDate) {
      return null;
    }

    const buyVol = toFiniteNumber(normalizedPayload.BuyVol ?? normalizedPayload.buyVol);
    const sellVol = toFiniteNumber(normalizedPayload.SellVol ?? normalizedPayload.sellVol);
    const buyVal = toFiniteNumber(normalizedPayload.BuyVal ?? normalizedPayload.buyVal);
    const sellVal = toFiniteNumber(normalizedPayload.SellVal ?? normalizedPayload.sellVal);
    const totalRoom = toFiniteNumber(normalizedPayload.TotalRoom ?? normalizedPayload.totalRoom);
    const currentRoom = toFiniteNumber(normalizedPayload.CurrentRoom ?? normalizedPayload.currentRoom);

    if (
      buyVol === null ||
      sellVol === null ||
      buyVal === null ||
      sellVal === null ||
      totalRoom === null
    ) {
      return null;
    }

    this.seq += 1;
    const tradingTime = String(normalizedPayload.Time ?? normalizedPayload.time ?? "").trim();

    return {
      symbol,
      tradeDate,
      tradingTime: tradingTime || undefined,
      ts: resolveForeignTimestamp(tradeDate, tradingTime),
      seq: this.seq,
      source: this.eventSource,
      marketStatus: String(
        normalizedPayload.TradingSession ?? normalizedPayload.marketStatus ?? "UNKNOWN"
      ),
      channel: "R",
      totalRoom: Math.trunc(totalRoom),
      currentRoom: currentRoom === null ? undefined : Math.trunc(currentRoom),
      buyVol: Math.trunc(buyVol),
      sellVol: Math.trunc(sellVol),
      buyVal: Math.trunc(buyVal),
      sellVal: Math.trunc(sellVal),
      marketId: normalizeOptionalString(normalizedPayload.MarketId ?? normalizedPayload.marketId),
      exchange: normalizeOptionalString(normalizedPayload.Exchange ?? normalizedPayload.exchange)
    };
  }

  nextHeartbeat(): NormalizedEvent {
    this.seq += 1;
    return {
      symbol: "HEARTBEAT",
      price: 0,
      ts: new Date().toISOString(),
      seq: this.seq,
      source: this.eventSource,
      isHeartbeat: true,
      marketStatus: "LIVE",
      channel: "HEARTBEAT"
    };
  }
}

export function unwrapPayload(payload: FastConnectPayload): FastConnectPayload {
  const content = payload.Content ?? payload.content;
  let mergedPayload: FastConnectPayload = { ...payload };

  if (typeof content === "string" && content.trim() !== "") {
    try {
      const parsed = JSON.parse(content) as FastConnectPayload;
      mergedPayload = {
        ...payload,
        ...parsed
      };
    } catch {
      // Ignore malformed nested content and fall back to the original payload shape.
    }
  } else if (content && typeof content === "object") {
    mergedPayload = {
      ...payload,
      ...(content as FastConnectPayload)
    };
  }

  return mergedPayload;
}

function resolveChannel(payload: FastConnectPayload): string {
  return String(payload.RType ?? payload.Rtype ?? payload.channel ?? payload.Datatype ?? "X").toUpperCase();
}

function normalizeOhlcv(payload: FastConnectPayload, channel: string): NormalizedOhlcv | null {
  if (channel !== "B") {
    return null;
  }

  const open = toFiniteNumber(payload.Open ?? payload.open);
  const high = toFiniteNumber(payload.High ?? payload.high);
  const low = toFiniteNumber(payload.Low ?? payload.low);
  const close = toFiniteNumber(payload.Close ?? payload.close ?? payload.LastVal ?? payload.price);
  const volume = toFiniteNumber(payload.Volume ?? payload.volume);
  const value = toFiniteNumber(payload.Value ?? payload.value) ?? 0;
  const tradingTime = String(payload.TradingTime ?? payload.tradingTime ?? "").trim();

  if (
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    tradingTime === ""
  ) {
    return null;
  }

  const tickTime = resolveTickTime(tradingTime);
  if (!tickTime) {
    return null;
  }

  return {
    open,
    high,
    low,
    close,
    volume,
    value,
    tradingTime,
    tickTime
  };
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function resolveTickTime(tradingTime: string): string | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(tradingTime);
  if (!match) {
    return null;
  }

  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRADING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const day = dateFormatter.format(now);
  const [, hour, minute] = match;
  return new Date(`${day}T${hour}:${minute}:00+07:00`).toISOString();
}

function normalizeTradingDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (raw === "") {
    return null;
  }

  const slashMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month}-${day}`;
  }

  const dashMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dashMatch) {
    return raw;
  }

  return null;
}

function resolveForeignTimestamp(tradeDate: string, tradingTime: string): string {
  const timePart = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(tradingTime);
  if (!timePart) {
    return new Date(`${tradeDate}T00:00:00+07:00`).toISOString();
  }

  const [, hour, minute, second = "00"] = timePart;
  return new Date(`${tradeDate}T${hour}:${minute}:${second}+07:00`).toISOString();
}

function normalizeOptionalString(value: unknown): string | undefined {
  const raw = String(value ?? "").trim();
  return raw === "" ? undefined : raw;
}
