import { Redis } from "ioredis";
import WebSocket from "ws";

type FastConnectPayload = Record<string, unknown>;

type NormalizedEvent = {
  symbol: string;
  price: number;
  ts: string;
  seq: number;
  source: "ssi-fastconnect";
  isHeartbeat: boolean;
  marketStatus: string;
  channel: string;
};

const wsUrl = process.env.FASTCONNECT_WS_URL ?? "wss://fc-datahub.ssi.com.vn/v2.0";
const redisHost = process.env.REDIS_HOST ?? "localhost";
const redisPort = Number(process.env.REDIS_PORT ?? 6379);
const redisPassword = process.env.REDIS_PASSWORD ?? "";
const channels = (process.env.FASTCONNECT_CHANNELS ?? "X,R,MI,F")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const redis = new Redis({
  host: redisHost,
  port: redisPort,
  password: redisPassword || undefined
});

let globalSeq = 0;
let ws: WebSocket | null = null;

function connect(): void {
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log(`[market-feed] connected to ${wsUrl}`);
    // SSI FastConnect auth/subscription payload can vary by account profile.
    // Use env-injected JSON to keep this service generic.
    const subscribePayload = process.env.FASTCONNECT_SUBSCRIBE_PAYLOAD;
    if (subscribePayload) {
      ws?.send(subscribePayload);
    } else {
      ws?.send(JSON.stringify({ type: "subscribe", channels }));
    }
  });

  ws.on("message", async (raw) => {
    try {
      const parsed = JSON.parse(raw.toString()) as FastConnectPayload;
      const event = normalize(parsed);
      if (!event) {
        return;
      }

      const payload = JSON.stringify(event);
      await redis.set(`price:snapshot:${event.symbol}`, payload);
      await redis.publish(`price:delta:${event.symbol}`, payload);
      await redis.set("price:health:last_seen", new Date().toISOString());
    } catch (error) {
      console.error("[market-feed] parse/publish error", error);
    }
  });

  ws.on("close", () => {
    console.warn("[market-feed] disconnected, retrying...");
    setTimeout(connect, 2000);
  });

  ws.on("error", (error) => {
    console.error("[market-feed] websocket error", error);
  });
}

function normalize(payload: FastConnectPayload): NormalizedEvent | null {
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

  globalSeq += 1;
  return {
    symbol,
    price,
    ts: new Date().toISOString(),
    seq: globalSeq,
    source: "ssi-fastconnect",
    isHeartbeat: false,
    marketStatus: String(payload.TradingSession ?? payload.marketStatus ?? "UNKNOWN"),
    channel
  };
}

setInterval(async () => {
  const heartbeat: NormalizedEvent = {
    symbol: "HEARTBEAT",
    price: 0,
    ts: new Date().toISOString(),
    seq: ++globalSeq,
    source: "ssi-fastconnect",
    isHeartbeat: true,
    marketStatus: "LIVE",
    channel: "HEARTBEAT"
  };
  const payload = JSON.stringify(heartbeat);
  await redis.publish("price:heartbeat", payload);
  await redis.set("price:health:last_seen", new Date().toISOString());
}, 1000);

connect();
