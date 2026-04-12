import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadConfig } from "./config/env.js";
import { createApiServer } from "./api/server.js";
import { RuntimeStateStore } from "./core/runtimeState.js";
import { RedisPublisher } from "./core/redisPublisher.js";
import { EventNormalizer } from "./socket/normalizer.js";
import { FastconnectClient } from "./socket/fastconnectClient.js";
import { HeartbeatScheduler } from "./socket/heartbeat.js";
import { SimulatedFeed } from "./socket/simulatedFeed.js";

// Load .env from the market-feed package root (not process.cwd()), so `npm run dev`
// works when the shell cwd is the monorepo root.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const state = new RuntimeStateStore();
  const normalizer = new EventNormalizer(config.eventSource);
  const publisher = new RedisPublisher({
    host: config.redisHost,
    port: config.redisPort,
    password: config.redisPassword,
    state
  });

  const simulatedFeed = new SimulatedFeed(config, state, publisher, normalizer);
  const heartbeat = new HeartbeatScheduler({
    intervalMs: config.heartbeatIntervalMs,
    publisher,
    normalizer
  });
  const api = await createApiServer({ state, publisher });

  console.log(
    `[market-feed] mode=${config.mode} (MARKET_FEED_MODE=${process.env.MARKET_FEED_MODE ?? "<unset>"})`
  );

  let socketClient: FastconnectClient | null = null;
  if (config.mode === "simulate") {
    simulatedFeed.start();
  } else {
    socketClient = new FastconnectClient({
      config,
      state,
      publisher,
      normalizer
    });
    socketClient.start();
  }
  heartbeat.start();
  await api.listen({ port: config.apiPort, host: "0.0.0.0" });
  console.log(`[market-feed] API listening on port ${config.apiPort}`);

  const shutdown = async () => {
    heartbeat.stop();
    if (config.mode === "simulate") {
      simulatedFeed.stop();
    } else if (socketClient) {
      await socketClient.stop();
    }
    await api.close();
    await publisher.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void bootstrap();
