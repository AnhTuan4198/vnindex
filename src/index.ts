import { loadConfig } from "./config/env.js";
import { createApiServer } from "./api/server.js";
import { RuntimeStateStore } from "./core/runtimeState.js";
import { RedisPublisher } from "./core/redisPublisher.js";
import { EventNormalizer } from "./socket/normalizer.js";
import { FastconnectClient } from "./socket/fastconnectClient.js";
import { HeartbeatScheduler } from "./socket/heartbeat.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const state = new RuntimeStateStore();
  const normalizer = new EventNormalizer();
  const publisher = new RedisPublisher({
    host: config.redisHost,
    port: config.redisPort,
    password: config.redisPassword,
    state
  });

  const socketClient = new FastconnectClient({
    config,
    state,
    publisher,
    normalizer
  });
  const heartbeat = new HeartbeatScheduler({
    intervalMs: config.heartbeatIntervalMs,
    publisher,
    normalizer
  });
  const api = await createApiServer({ state, publisher });

  socketClient.start();
  heartbeat.start();
  await api.listen({ port: config.apiPort, host: "0.0.0.0" });
  console.log(`[market-feed] API listening on port ${config.apiPort}`);

  const shutdown = async () => {
    heartbeat.stop();
    await socketClient.stop();
    await api.close();
    await publisher.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void bootstrap();
