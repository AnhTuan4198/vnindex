import WebSocket from "ws";
import type { AppConfig } from "../config/env.js";
import type { FastConnectPayload } from "../core/types.js";
import { RuntimeStateStore } from "../core/runtimeState.js";
import { RedisPublisher } from "../core/redisPublisher.js";
import { EventNormalizer } from "./normalizer.js";

export class FastconnectClient {
  private ws: WebSocket | null = null;
  private readonly config: AppConfig;
  private readonly state: RuntimeStateStore;
  private readonly publisher: RedisPublisher;
  private readonly normalizer: EventNormalizer;
  private shutdownRequested = false;

  constructor(params: {
    config: AppConfig;
    state: RuntimeStateStore;
    publisher: RedisPublisher;
    normalizer: EventNormalizer;
  }) {
    this.config = params.config;
    this.state = params.state;
    this.publisher = params.publisher;
    this.normalizer = params.normalizer;
  }

  start(): void {
    this.connect();
  }

  private connect(): void {
    if (this.shutdownRequested) return;
    this.ws = new WebSocket(this.config.wsUrl);

    this.ws.on("open", () => {
      this.state.setWsConnected(true);
      console.log(`[market-feed] connected to ${this.config.wsUrl}`);
      if (this.config.subscribePayload) {
        this.ws?.send(this.config.subscribePayload);
      } else {
        this.ws?.send(
          JSON.stringify({
            type: "subscribe",
            channels: this.config.channels
          })
        );
      }
    });

    this.ws.on("message", async (raw) => {
      this.state.markMessageReceived();
      try {
        const payload = JSON.parse(raw.toString()) as FastConnectPayload;
        const foreignEvent = this.normalizer.nextForeignTransaction(payload);
        if (foreignEvent) {
          await this.publisher.publishForeignTransaction(foreignEvent);
          return;
        }
        const event = this.normalizer.nextDelta(payload);
        if (!event) {
          return;
        }
        await this.publisher.publishDelta(event);
      } catch (error) {
        this.state.incrementParseError();
        console.error("[market-feed] parse/publish error", error);
      }
    });

    this.ws.on("close", () => {
      this.state.setWsConnected(false);
      if (this.shutdownRequested) return;
      this.state.incrementReconnect();
      console.warn("[market-feed] disconnected, retrying...");
      setTimeout(() => this.connect(), this.config.reconnectDelayMs);
    });

    this.ws.on("error", (error) => {
      console.error("[market-feed] websocket error", error);
    });
  }

  async stop(): Promise<void> {
    this.shutdownRequested = true;
    this.state.setWsConnected(false);
    if (!this.ws) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.ws?.once("close", () => resolve());
      this.ws?.close();
      setTimeout(() => resolve(), 1000);
    });
    this.ws = null;
  }
}
