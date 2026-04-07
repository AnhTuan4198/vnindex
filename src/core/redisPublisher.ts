import { Redis } from "ioredis";
import type { NormalizedEvent } from "./types.js";
import { RuntimeStateStore } from "./runtimeState.js";

const LAST_SEEN_KEY = "price:health:last_seen";

export class RedisPublisher {
  private redis: Redis;
  private state: RuntimeStateStore;

  constructor(params: {
    host: string;
    port: number;
    password?: string;
    state: RuntimeStateStore;
  }) {
    this.redis = new Redis({
      host: params.host,
      port: params.port,
      password: params.password || undefined
    });
    this.state = params.state;
  }

  async publishDelta(event: NormalizedEvent): Promise<void> {
    const payload = JSON.stringify(event);
    try {
      await this.redis.set(`price:snapshot:${event.symbol}`, payload);
      await this.redis.publish(`price:delta:${event.symbol}`, payload);
      await this.redis.set(LAST_SEEN_KEY, new Date().toISOString());
      this.state.incrementPublished();
    } catch (error) {
      this.state.incrementPublishError();
      throw error;
    }
  }

  async publishHeartbeat(event: NormalizedEvent): Promise<void> {
    const payload = JSON.stringify(event);
    try {
      await this.redis.publish("price:heartbeat", payload);
      await this.redis.set(LAST_SEEN_KEY, new Date().toISOString());
      this.state.markHeartbeatPublished();
      this.state.incrementPublished();
    } catch (error) {
      this.state.incrementPublishError();
      throw error;
    }
  }

  async ping(): Promise<string> {
    return this.redis.ping();
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
