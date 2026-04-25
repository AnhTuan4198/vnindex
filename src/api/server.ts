import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./routes/health.js";
import { RuntimeStateStore } from "../core/runtimeState.js";
import { RedisPublisher } from "../core/redisPublisher.js";
import { registerFastconnectRestRoutes } from "./routes/fastconnectRest.js";
import { FastconnectRestClient } from "./fastconnectRestClient.js";

export async function createApiServer(params: {
  state: RuntimeStateStore;
  publisher: RedisPublisher;
  fastconnectRestClient: FastconnectRestClient;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await registerHealthRoutes(app, params);
  await registerFastconnectRestRoutes(app, { client: params.fastconnectRestClient });
  return app;
}
