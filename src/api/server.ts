import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./routes/health.js";
import { RuntimeStateStore } from "../core/runtimeState.js";
import { RedisPublisher } from "../core/redisPublisher.js";

export async function createApiServer(params: {
  state: RuntimeStateStore;
  publisher: RedisPublisher;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await registerHealthRoutes(app, params);
  return app;
}
