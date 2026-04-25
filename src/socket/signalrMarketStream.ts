/** SSI FastConnect hub (SignalR 2.x / ASP.NET SignalR). */

export const SIGNALR_HUB_NAME = "fcmarketdatav2hub";
export const SIGNALR_CLIENT_PROTOCOL = "1.3";

export type NegotiateResult = {
  ConnectionToken: string;
  ConnectionId: string;
  TryWebSockets?: boolean;
};

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function buildConnectionData(): string {
  return JSON.stringify([{ name: SIGNALR_HUB_NAME }]);
}

export async function signalrNegotiate(
  httpsSignalRBase: string,
  authorizationHeader: string,
  timeoutMs: number
): Promise<NegotiateResult> {
  const connectionData = buildConnectionData();
  const qs = new URLSearchParams({
    clientProtocol: SIGNALR_CLIENT_PROTOCOL,
    connectionData
  });
  const url = `${trimSlash(httpsSignalRBase)}/negotiate?${qs.toString()}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: authorizationHeader },
      signal: controller.signal
    });
  } finally {
    clearTimeout(t);
  }

  if (res.status === 401 || res.status === 403 || res.status === 302) {
    const err = new Error(`SignalR negotiate unauthorized (HTTP ${res.status})`);
    (err as Error & { statusCode?: number }).statusCode = res.status;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`SignalR negotiate failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as NegotiateResult;
  if (body.TryWebSockets === false) {
    throw new Error("SignalR server does not offer WebSockets");
  }
  if (!body.ConnectionToken || !body.ConnectionId) {
    throw new Error("SignalR negotiate response missing ConnectionToken/ConnectionId");
  }
  return body;
}

export function buildSignalRConnectUrl(
  wssSignalRBase: string,
  connectionToken: string,
  connectionData: string
): string {
  const qs = new URLSearchParams({
    clientProtocol: SIGNALR_CLIENT_PROTOCOL,
    transport: "webSockets",
    connectionToken,
    connectionData,
    tid: "10"
  });
  return `${trimSlash(wssSignalRBase)}/connect?${qs.toString()}`;
}

export async function signalrStart(
  httpsSignalRBase: string,
  connectionToken: string,
  connectionData: string,
  authorizationHeader: string,
  timeoutMs: number
): Promise<void> {
  const qs = new URLSearchParams({
    clientProtocol: SIGNALR_CLIENT_PROTOCOL,
    transport: "webSockets",
    connectionData,
    connectionToken
  });
  const url = `${trimSlash(httpsSignalRBase)}/start?${qs.toString()}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: authorizationHeader },
      signal: controller.signal
    });
  } finally {
    clearTimeout(t);
  }

  if (res.status === 401 || res.status === 403 || res.status === 302) {
    const err = new Error(`SignalR start unauthorized (HTTP ${res.status})`);
    (err as Error & { statusCode?: number }).statusCode = res.status;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`SignalR start failed (HTTP ${res.status})`);
  }
}

type HubMessage = { H?: string; M?: string; A?: unknown[] };

type SignalREnvelope = { M?: HubMessage[]; I?: number };

/** Extract server-push payloads from `FcMarketDataV2Hub.Broadcast` frames. */
export function extractBroadcastPayloads(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "{}") {
    return [];
  }
  let parsed: SignalREnvelope;
  try {
    parsed = JSON.parse(trimmed) as SignalREnvelope;
  } catch {
    return [];
  }
  const list = parsed.M;
  if (!Array.isArray(list) || list.length === 0) {
    return [];
  }
  const out: unknown[] = [];
  for (const mesg of list) {
    const hub = String(mesg.H ?? "").toLowerCase();
    const method = String(mesg.M ?? "").toLowerCase();
    if (hub !== SIGNALR_HUB_NAME || method !== "broadcast") {
      continue;
    }
    const args = mesg.A;
    if (!Array.isArray(args)) {
      continue;
    }
    for (const item of args) {
      out.push(item);
    }
  }
  return out;
}

export function buildHubInvocation(
  hubName: string,
  methodName: string,
  args: unknown[],
  messageId: number
): string {
  return JSON.stringify({
    H: hubName,
    M: methodName,
    A: args,
    I: messageId
  });
}
