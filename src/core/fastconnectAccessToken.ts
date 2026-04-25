const ACCESS_TOKEN_PATH = "api/v2/Market/AccessToken";

export class AuthError extends Error {
  readonly kind = "auth" as const;

  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

type TokenResponse = {
  status?: number;
  message?: string;
  data?: {
    accessToken?: string;
    expiresIn?: number;
  };
};

export class FastconnectAccessToken {
  private cached: { value: string; expiresAtMs: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly params: {
      apiBaseUrl: string;
      consumerId: string;
      consumerSecret: string;
      httpTimeoutMs: number;
      defaultTtlSec: number;
      refreshLeadMs: number;
    }
  ) {}

  /** Returns the full `Authorization` header value, e.g. `Bearer <jwt>`. */
  async getAuthorizationHeader(): Promise<string> {
    const now = Date.now();
    const refreshAt =
      this.cached === null ? 0 : this.cached.expiresAtMs - this.params.refreshLeadMs;
    if (this.cached && now < refreshAt) {
      return this.cached.value;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.fetchAndCache().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  invalidate(): void {
    this.cached = null;
  }

  private async fetchAndCache(): Promise<string> {
    const url = `${this.params.apiBaseUrl.replace(/\/+$/, "")}/${ACCESS_TOKEN_PATH}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.params.httpTimeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consumerID: this.params.consumerId,
          consumerSecret: this.params.consumerSecret
        }),
        signal: controller.signal
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw new Error(`AccessToken request timed out after ${this.params.httpTimeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`AccessToken HTTP ${res.status}`);
    }

    let body: TokenResponse;
    try {
      body = (await res.json()) as TokenResponse;
    } catch {
      throw new Error(`AccessToken invalid JSON (HTTP ${res.status})`);
    }

    if (!res.ok) {
      throw new Error(`AccessToken HTTP ${res.status}: ${body.message ?? res.statusText}`);
    }

    if (body.status !== 200) {
      throw new AuthError(body.message ?? `AccessToken status ${body.status ?? "unknown"}`);
    }

    const accessToken = body.data?.accessToken;
    if (!accessToken) {
      throw new Error("AccessToken response missing data.accessToken");
    }

    const ttlSec =
      typeof body.data?.expiresIn === "number" && body.data.expiresIn > 60
        ? body.data.expiresIn
        : this.params.defaultTtlSec;

    const value = `Bearer ${accessToken}`;
    this.cached = {
      value,
      expiresAtMs: Date.now() + ttlSec * 1000
    };
    return value;
  }
}
