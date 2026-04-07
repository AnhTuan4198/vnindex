import { RedisPublisher } from "../core/redisPublisher.js";
import { EventNormalizer } from "./normalizer.js";

export class HeartbeatScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly publisher: RedisPublisher;
  private readonly normalizer: EventNormalizer;

  constructor(params: {
    intervalMs: number;
    publisher: RedisPublisher;
    normalizer: EventNormalizer;
  }) {
    this.intervalMs = params.intervalMs;
    this.publisher = params.publisher;
    this.normalizer = params.normalizer;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      try {
        await this.publisher.publishHeartbeat(this.normalizer.nextHeartbeat());
      } catch (error) {
        console.error("[market-feed] heartbeat publish error", error);
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
