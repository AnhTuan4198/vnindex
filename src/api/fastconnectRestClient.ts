import type { AppConfig } from "../config/env.js";
import { FastconnectAccessToken } from "../core/fastconnectAccessToken.js";

const REST_PATHS = {
  securities: "api/v2/Market/Securities",
  securitiesDetails: "api/v2/Market/SecuritiesDetails",
  indexComponents: "api/v2/Market/IndexComponents",
  indexList: "api/v2/Market/IndexList",
  dailyOhlc: "api/v2/Market/DailyOhlc",
  intradayOhlc: "api/v2/Market/IntradayOhlc",
  dailyIndex: "api/v2/Market/DailyIndex",
  dailyStockPrice: "api/v2/Market/DailyStockPrice"
} as const;

type RestResource = keyof typeof REST_PATHS;

export class FastconnectRestClient {
  private readonly token: FastconnectAccessToken;

  constructor(private readonly config: AppConfig) {
    this.token = new FastconnectAccessToken({
      apiBaseUrl: config.fastconnectApiBaseUrl,
      consumerId: config.consumerId,
      consumerSecret: config.consumerSecret,
      httpTimeoutMs: config.httpRequestTimeoutMs,
      defaultTtlSec: config.accessTokenDefaultTtlSec,
      refreshLeadMs: config.tokenRefreshLeadMs
    });
  }

  canCall(): boolean {
    return this.config.consumerId.length > 0 && this.config.consumerSecret.length > 0;
  }

  async get(resource: RestResource, lookupRequest: Record<string, unknown>): Promise<unknown> {
    if (!this.canCall()) {
      throw new Error("REST proxy requires CONSUMER_ID and CONSUMER_SECRET");
    }
    return this.getWithRetry(resource, lookupRequest, true);
  }

  private async getWithRetry(
    resource: RestResource,
    lookupRequest: Record<string, unknown>,
    allowRetry: boolean
  ): Promise<unknown> {
    const path = REST_PATHS[resource];
    const authHeader = await this.token.getAuthorizationHeader();
    const url = new URL(`${this.config.fastconnectApiBaseUrl.replace(/\/+$/, "")}/${path}`);
    for (const [key, value] of Object.entries(lookupRequest)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(`lookupRequest.${key}`, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.httpRequestTimeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: authHeader
        },
        signal: controller.signal
      });
      if ((response.status === 401 || response.status === 403) && allowRetry) {
        this.token.invalidate();
        return this.getWithRetry(resource, lookupRequest, false);
      }
      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`FastConnect REST ${path} failed: HTTP ${response.status} ${bodyText}`);
      }
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }
}
