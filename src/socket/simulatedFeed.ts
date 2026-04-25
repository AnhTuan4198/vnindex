import type { AppConfig } from "../config/env.js";
import { resolveSimBasePrice } from "../config/env.js";
import type { FastConnectPayload } from "../core/types.js";
import { RuntimeStateStore } from "../core/runtimeState.js";
import { RedisPublisher } from "../core/redisPublisher.js";
import { EventNormalizer } from "./normalizer.js";

const TRADING_SESSIONS = ["LO", "ATC", "PT", "LO"];

export class SimulatedFeed {
  private timer: NodeJS.Timeout | null = null;
  private symbolIndex = 0;
  private channelIndex = 0;
  private sessionIndex = 0;
  private barIndex = 0;
  private readonly lastPrice = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly state: RuntimeStateStore,
    private readonly publisher: RedisPublisher,
    private readonly normalizer: EventNormalizer
  ) {}

  start(): void {
    if (this.timer) return;
    const symbols = this.config.simSymbols;
    if (symbols.length === 0) {
      console.warn("[market-feed] simulate mode: SIM_SYMBOLS empty, no ticks");
      return;
    }
    for (const sym of symbols) {
      this.lastPrice.set(sym, resolveSimBasePrice(sym, this.config));
    }
    this.state.setWsConnected(true);
    console.log(
      `[market-feed] simulate mode: ${symbols.join(", ")} every ${this.config.simTickIntervalMs}ms`
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.simTickIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.state.setWsConnected(false);
  }

  private async tick(): Promise<void> {
    const symbols = this.config.simSymbols;
    if (symbols.length === 0) return;

    const symbol = symbols[this.symbolIndex % symbols.length]!;
    this.symbolIndex += 1;

    const channels =
      this.config.channels.length > 0 ? this.config.channels : ["X"];
    const rtype = channels[this.channelIndex % channels.length]!;
    this.channelIndex += 1;

    const session = TRADING_SESSIONS[this.sessionIndex % TRADING_SESSIONS.length]!;
    this.sessionIndex += 1;

    let prev = this.lastPrice.get(symbol) ?? resolveSimBasePrice(symbol, this.config);
    const step = this.config.simPriceStep;
    const delta = (Math.random() * 2 - 1) * step;
    prev = Math.max(0.01, prev + delta);
    const rounded = Math.round(prev * 100) / 100;
    this.lastPrice.set(symbol, rounded);

    const payload =
      rtype === "B"
        ? this.buildBarPayload(symbol, rounded, session)
        : rtype === "R"
          ? this.buildForeignPayload(symbol, rounded, session)
        : {
            Symbol: symbol,
            LastVal: rounded,
            Rtype: rtype,
            TradingSession: session
          };

    this.state.markMessageReceived();
    try {
      const foreignEvent = this.normalizer.nextForeignTransaction(payload);
      if (foreignEvent) {
        await this.publisher.publishForeignTransaction(foreignEvent);
        return;
      }
      const event = this.normalizer.nextDelta(payload);
      if (!event) return;
      await this.publisher.publishDelta(event);
    } catch (error) {
      this.state.incrementParseError();
      console.error("[market-feed] simulate tick error", error);
    }
  }

  private buildBarPayload(symbol: string, close: number, session: string): FastConnectPayload {
    const open = roundPrice(close - this.config.simPriceStep);
    const high = roundPrice(Math.max(open, close) + this.config.simPriceStep);
    const low = roundPrice(Math.max(0.01, Math.min(open, close) - this.config.simPriceStep));
    const volume = Math.max(
      1,
      Math.round(this.config.simVolumeBase + this.barIndex * this.config.simVolumeStep)
    );
    this.barIndex += 1;

    return {
      Datatype: "B",
      Content: JSON.stringify({
        RType: "B",
        Symbol: symbol,
        TradingTime: currentTradingTime(),
        Open: open,
        High: high,
        Low: low,
        Close: close,
        Volume: volume,
        Value: Math.round(close * volume)
      }),
      Rtype: "B",
      TradingSession: session
    };
  }

  private buildForeignPayload(symbol: string, close: number, session: string): FastConnectPayload {
    const baseVolume = Math.max(
      1,
      Math.round(this.config.simVolumeBase + this.barIndex * this.config.simVolumeStep)
    );
    this.barIndex += 1;

    const buyVol = baseVolume;
    const sellVol = Math.max(1, baseVolume - Math.round(this.config.simVolumeStep / 2));
    const totalRoom = 1_500_000_000 + this.barIndex * 1_000;
    const currentRoom = Math.max(0, totalRoom - buyVol + sellVol);
    const buyVal = Math.round(close * buyVol * 1_000);
    const sellVal = Math.round(close * sellVol * 1_000);

    return {
      Datatype: "R",
      Content: JSON.stringify({
        RType: "R",
        TradingDate: currentTradingDate(),
        Time: currentTradingTime(),
        Isin: symbol,
        Symbol: symbol,
        TotalRoom: totalRoom,
        CurrentRoom: currentRoom,
        BuyVol: buyVol,
        SellVol: sellVol,
        BuyVal: buyVal,
        SellVal: sellVal,
        MarketId: "HOSE",
        Exchange: "HOSE"
      }),
      Rtype: "R",
      TradingSession: session
    };
  }
}

function currentTradingDate(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  return formatter.format(now);
}

function currentTradingTime(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  return formatter.format(now);
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}
