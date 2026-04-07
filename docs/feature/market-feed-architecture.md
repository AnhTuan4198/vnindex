# Market-Feed Architecture

## Overview

`market-feed` ingests SSI FastConnect market data, normalizes events, and publishes them to Redis for downstream services (notably `phinde` SSE fan-out).

The service is modularized into:
- socket ingestion module
- REST API module (Fastify)

## Module Structure

- `src/index.ts`
  - bootstrap/composition only
  - wires config, state, Redis publisher, socket client, heartbeat, API server
- `src/config/env.ts`
  - centralized environment loading
- `src/core/types.ts`
  - shared payload and runtime state contracts
- `src/core/runtimeState.ts`
  - in-memory runtime counters and health fields
- `src/core/redisPublisher.ts`
  - Redis writes/publish abstraction for snapshot, delta, heartbeat
- `src/socket/normalizer.ts`
  - converts SSI payloads into normalized events
- `src/socket/fastconnectClient.ts`
  - websocket lifecycle: connect, subscribe, message, reconnect, shutdown
- `src/socket/heartbeat.ts`
  - periodic heartbeat publishing
- `src/api/server.ts`
  - Fastify server composition
- `src/api/routes/health.ts`
  - `GET /health` endpoint

## Data Contract

Normalized event shape:

```json
{
  "symbol": "SSI",
  "price": 24.2,
  "ts": "2026-04-07T09:00:00.000Z",
  "seq": 123456,
  "source": "ssi-fastconnect",
  "isHeartbeat": false,
  "marketStatus": "LO",
  "channel": "X"
}
```

Redis outputs:
- snapshot key: `price:snapshot:{symbol}`
- delta channel: `price:delta:{symbol}`
- heartbeat channel: `price:heartbeat`
- health marker: `price:health:last_seen`

## Runtime Flow

1. FastConnect websocket connects and subscribes (payload from env or default channels).
2. incoming messages are normalized.
3. normalized deltas are published to Redis (`snapshot + delta channel`).
4. heartbeat scheduler publishes 1-second heartbeat.
5. Fastify exposes health/status from runtime counters and Redis ping.

## REST API

### `GET /health`

Returns:
- service status
- process uptime
- Redis state (`up` / `down`)
- stream runtime state:
  - websocket connection state
  - reconnect count
  - last message timestamp
  - last heartbeat timestamp
  - received/published/error counters

## Environment Variables

- `FASTCONNECT_WS_URL` (default `wss://fc-datahub.ssi.com.vn/v2.0`)
- `FASTCONNECT_CHANNELS` (default `X,R,MI,F`)
- `FASTCONNECT_SUBSCRIBE_PAYLOAD` (optional raw subscribe payload)
- `FASTCONNECT_RECONNECT_MS` (default `2000`)
- `HEARTBEAT_INTERVAL_MS` (default `1000`)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `MARKET_FEED_PORT` or `PORT` (API port, default `8100`)

## Graceful Shutdown

On `SIGINT`/`SIGTERM`:
- stop heartbeat timer
- close websocket client
- close Fastify server
- close Redis connection

## Notes

- Build currently passes in this repository.
- Some dependencies recommend Node >=20; runtime should use Node 20+ (Docker image uses Node 22).
