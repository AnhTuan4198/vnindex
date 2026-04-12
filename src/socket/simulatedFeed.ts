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

    const payload: FastConnectPayload = {
      Symbol: symbol,
      LastVal: rounded,
      Rtype: rtype,
      TradingSession: session
    };

    this.state.markMessageReceived();
    try {
      const event = this.normalizer.nextDelta(payload);
      if (!event) return;
      await this.publisher.publishDelta(event);
    } catch (error) {
      this.state.incrementParseError();
      console.error("[market-feed] simulate tick error", error);
    }
  }
}
