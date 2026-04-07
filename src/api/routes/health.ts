import type { FastifyInstance } from "fastify";
import { RuntimeStateStore } from "../../core/runtimeState.js";
import { RedisPublisher } from "../../core/redisPublisher.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: {
    state: RuntimeStateStore;
    publisher: RedisPublisher;
  }
): Promise<void> {
  app.get("/health", async () => {
    let redisStatus = "down";
    try {
      const pong = await deps.publisher.ping();
      redisStatus = pong.toUpperCase() === "PONG" ? "up" : "unknown";
    } catch {
      redisStatus = "down";
    }

    return {
      status: "ok",
      uptimeSec: Math.floor(process.uptime()),
      redis: redisStatus,
      stream: deps.state.snapshot()
    };
  });
}
