import type { FastifyInstance } from "fastify";
import { FastconnectRestClient } from "../fastconnectRestClient.js";

type LookupQuery = Record<string, string | number | boolean | undefined>;

function asLookupRequest(query: LookupQuery): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export async function registerFastconnectRestRoutes(
  app: FastifyInstance,
  deps: { client: FastconnectRestClient }
): Promise<void> {
  app.get<{ Querystring: LookupQuery }>("/market/securities", async (request, reply) => {
    if (!deps.client.canCall()) {
      return reply.code(503).send({ message: "Missing CONSUMER_ID or CONSUMER_SECRET" });
    }
    return deps.client.get("securities", asLookupRequest(request.query));
  });

  app.get<{ Querystring: LookupQuery }>(
    "/market/securities-details",
    async (request, reply) => {
      if (!deps.client.canCall()) {
        return reply.code(503).send({ message: "Missing CONSUMER_ID or CONSUMER_SECRET" });
      }
      return deps.client.get("securitiesDetails", asLookupRequest(request.query));
    }
  );

  app.get<{ Querystring: LookupQuery }>(
    "/market/index-components",
    async (request, reply) => {
      if (!deps.client.canCall()) {
        return reply.code(503).send({ message: "Missing CONSUMER_ID or CONSUMER_SECRET" });
      }
      return deps.client.get("indexComponents", asLookupRequest(request.query));
    }
  );

  app.get<{ Querystring: LookupQuery }>("/market/index-list", async (request, reply) => {
    if (!deps.client.canCall()) {
      return reply.code(503).send({ message: "Missing CONSUMER_ID or CONSUMER_SECRET" });
    }
    return deps.client.get("indexList", asLookupRequest(request.query));
  });

  app.get<{ Querystring: LookupQuery }>("/market/daily-ohlc", async (request, reply) => {
    if (!deps.client.canCall()) {
      return reply.code(503).send({ message: "Missing CONSUMER_ID or CONSUMER_SECRET" });
    }
    return deps.client.get("dailyOhlc", asLookupRequest(request.query));
  });

  app.get<{ Querystring: LookupQuery }>(
    "/market/intraday-ohlc",
    async (request, reply) => {
      if (!deps.client.canCall()) {
        return reply.code(503).send({ message: "Missing CONSUMER_ID or CONSUMER_SECRET" });
      }
      return deps.client.get("intradayOhlc", asLookupRequest(request.query));
    }
  );

  app.get<{ Querystring: LookupQuery }>("/market/daily-index", async (request, reply) => {
    if (!deps.client.canCall()) {
      return reply.code(503).send({ message: "Missing CONSUMER_ID or CONSUMER_SECRET" });
    }
    return deps.client.get("dailyIndex", asLookupRequest(request.query));
  });

  app.get<{ Querystring: LookupQuery }>(
    "/market/daily-stock-price",
    async (request, reply) => {
      if (!deps.client.canCall()) {
        return reply.code(503).send({ message: "Missing CONSUMER_ID or CONSUMER_SECRET" });
      }
      return deps.client.get("dailyStockPrice", asLookupRequest(request.query));
    }
  );
}
