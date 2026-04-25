import { once } from "node:events";
import WebSocket from "ws";
import type { AppConfig } from "../config/env.js";
import { AuthError, FastconnectAccessToken } from "../core/fastconnectAccessToken.js";
import type { FastConnectPayload } from "../core/types.js";
import { RuntimeStateStore } from "../core/runtimeState.js";
import { RedisPublisher } from "../core/redisPublisher.js";
import { EventNormalizer } from "./normalizer.js";
import {
  buildHubInvocation,
  buildSignalRConnectUrl,
  extractBroadcastPayloads,
  signalrNegotiate,
  signalrStart,
  SIGNALR_HUB_NAME
} from "./signalrMarketStream.js";

function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof AuthError) {
    return true;
  }
  const status = (error as { statusCode?: number })?.statusCode;
  if (status === 401 || status === 403) {
    return true;
  }
  const msg = String((error as Error)?.message ?? error);
  return /unauthorized/i.test(msg) && /401|403|negotiate|start|AccessToken/i.test(msg);
}

function toPayload(data: unknown): FastConnectPayload | null {
  if (data === null || data === undefined) {
    return null;
  }
  if (typeof data === "string") {
    const t = data.trim();
    if (t === "") {
      return null;
    }
    try {
      return JSON.parse(t) as FastConnectPayload;
    } catch {
      return null;
    }
  }
  if (typeof data === "object") {
    return data as FastConnectPayload;
  }
  return null;
}

export class FastconnectClient {
  private ws: WebSocket | null = null;
  private readonly config: AppConfig;
  private readonly state: RuntimeStateStore;
  private readonly publisher: RedisPublisher;
  private readonly normalizer: EventNormalizer;
  private readonly token: FastconnectAccessToken;
  private shutdownRequested = false;
  private connectInFlight: Promise<void> | null = null;
  private signalRMessageId = 0;

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
    this.token = new FastconnectAccessToken({
      apiBaseUrl: params.config.fastconnectApiBaseUrl,
      consumerId: params.config.consumerId,
      consumerSecret: params.config.consumerSecret,
      httpTimeoutMs: params.config.httpRequestTimeoutMs,
      defaultTtlSec: params.config.accessTokenDefaultTtlSec,
      refreshLeadMs: params.config.tokenRefreshLeadMs
    });
  }

  start(): void {
    void this.scheduleConnect(0);
  }

  private scheduleConnect(delayMs: number): void {
    if (this.shutdownRequested) {
      return;
    }
    setTimeout(() => {
      void this.runConnectSession();
    }, delayMs);
  }

  private async runConnectSession(): Promise<void> {
    if (this.shutdownRequested) {
      return;
    }
    if (this.connectInFlight) {
      return this.connectInFlight;
    }
    this.connectInFlight = this.connectOnce().finally(() => {
      this.connectInFlight = null;
    });
    return this.connectInFlight;
  }

  private async connectOnce(): Promise<void> {
    if (this.shutdownRequested) {
      return;
    }

    const connectionData = JSON.stringify([{ name: SIGNALR_HUB_NAME }]);

    try {
      await this.connectSignalRSession(connectionData);
    } catch (first) {
      if (this.shutdownRequested) {
        return;
      }
      if (isUnauthorizedError(first)) {
        this.token.invalidate();
        try {
          await this.connectSignalRSession(connectionData);
          return;
        } catch (second) {
          console.error("[market-feed] SignalR connect failed after token refresh", second);
        }
      } else {
        console.error("[market-feed] SignalR connect failed", first);
      }

      this.state.setWsConnected(false);
      this.state.incrementReconnect();
      this.scheduleConnect(this.config.reconnectDelayMs);
    }
  }

  private async connectSignalRSession(connectionData: string): Promise<void> {
    const authHeader = await this.token.getAuthorizationHeader();
    const negotiated = await signalrNegotiate(
      this.config.signalRHttpsBase,
      authHeader,
      this.config.httpRequestTimeoutMs
    );

    const connectUrl = buildSignalRConnectUrl(
      this.config.signalRWssBase,
      negotiated.ConnectionToken,
      connectionData
    );

    const ws = new WebSocket(connectUrl, {
      headers: { Authorization: authHeader }
    });

    let closeArmed = false;

    ws.on("message", (raw) => {
      void this.handleSignalRMessage(raw);
    });

    ws.once("error", (err) => {
      console.error("[market-feed] websocket error", err);
    });

    ws.on("close", () => {
      if (this.ws !== ws) {
        return;
      }
      this.ws = null;
      this.state.setWsConnected(false);
      if (!closeArmed || this.shutdownRequested) {
        return;
      }
      this.state.incrementReconnect();
      console.warn("[market-feed] SignalR disconnected, retrying...");
      this.scheduleConnect(this.config.reconnectDelayMs);
    });

    this.ws = ws;

    try {
      await once(ws, "open");
      await signalrStart(
        this.config.signalRHttpsBase,
        negotiated.ConnectionToken,
        connectionData,
        authHeader,
        this.config.httpRequestTimeoutMs
      );

      this.signalRMessageId = 0;
      for (const channelSpec of this.config.signalrChannelSpecs) {
        this.signalRMessageId += 1;
        ws.send(
          buildHubInvocation(
            SIGNALR_HUB_NAME,
            "SwitchChannels",
            [channelSpec],
            this.signalRMessageId
          )
        );
      }

      this.state.setWsConnected(true);
      closeArmed = true;
      console.log(
        `[market-feed] SignalR connected ${this.config.signalRWssBase} channels=${this.config.signalrChannelSpecs.join(",")}`
      );
    } catch (e) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (this.ws === ws) {
        this.ws = null;
      }
      throw e;
    }
  }

  private async handleSignalRMessage(raw: WebSocket.RawData): Promise<void> {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    const payloads = extractBroadcastPayloads(text);
    if (payloads.length === 0) {
      return;
    }
    for (const item of payloads) {
      const payload = toPayload(item);
      if (!payload) {
        continue;
      }
      this.state.markMessageReceived();
      try {
        const foreignEvent = this.normalizer.nextForeignTransaction(payload);
        if (foreignEvent) {
          await this.publisher.publishForeignTransaction(foreignEvent);
          continue;
        }
        const event = this.normalizer.nextDelta(payload);
        if (!event) {
          continue;
        }
        await this.publisher.publishDelta(event);
      } catch (error) {
        this.state.incrementParseError();
        console.error("[market-feed] parse/publish error", error);
      }
    }
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
