export type AppConfig = {
  wsUrl: string;
  redisHost: string;
  redisPort: number;
  redisPassword: string;
  channels: string[];
  subscribePayload?: string;
  apiPort: number;
  heartbeatIntervalMs: number;
  reconnectDelayMs: number;
};

export function loadConfig(): AppConfig {
  return {
    wsUrl: process.env.FASTCONNECT_WS_URL ?? "wss://fc-datahub.ssi.com.vn/v2.0",
    redisHost: process.env.REDIS_HOST ?? "localhost",
    redisPort: Number(process.env.REDIS_PORT ?? 6379),
    redisPassword: process.env.REDIS_PASSWORD ?? "",
    channels: (process.env.FASTCONNECT_CHANNELS ?? "X,R,MI,F")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    subscribePayload: process.env.FASTCONNECT_SUBSCRIBE_PAYLOAD,
    apiPort: Number(process.env.MARKET_FEED_PORT ?? process.env.PORT ?? 8100),
    heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS ?? 1000),
    reconnectDelayMs: Number(process.env.FASTCONNECT_RECONNECT_MS ?? 2000)
  };
}
