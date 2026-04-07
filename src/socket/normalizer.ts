import type { FastConnectPayload, NormalizedEvent } from "../core/types.js";

export class EventNormalizer {
  private seq = 0;

  nextDelta(payload: FastConnectPayload): NormalizedEvent | null {
    const channel = String(payload.Rtype ?? payload.channel ?? "X");
    const symbol = String(payload.Symbol ?? payload.symbol ?? "").toUpperCase();
    if (!symbol) {
      return null;
    }

    const priceRaw = payload.LastVal ?? payload.Close ?? payload.price ?? 0;
    const price = Number(priceRaw);
    if (Number.isNaN(price)) {
      return null;
    }

    this.seq += 1;
    return {
      symbol,
      price,
      ts: new Date().toISOString(),
      seq: this.seq,
      source: "ssi-fastconnect",
      isHeartbeat: false,
      marketStatus: String(payload.TradingSession ?? payload.marketStatus ?? "UNKNOWN"),
      channel
    };
  }

  nextHeartbeat(): NormalizedEvent {
    this.seq += 1;
    return {
      symbol: "HEARTBEAT",
      price: 0,
      ts: new Date().toISOString(),
      seq: this.seq,
      source: "ssi-fastconnect",
      isHeartbeat: true,
      marketStatus: "LIVE",
      channel: "HEARTBEAT"
    };
  }
}
