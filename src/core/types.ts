export type FastConnectPayload = Record<string, unknown>;

export type NormalizedEvent = {
  symbol: string;
  price: number;
  ts: string;
  seq: number;
  source: "ssi-fastconnect";
  isHeartbeat: boolean;
  marketStatus: string;
  channel: string;
};

export type RuntimeState = {
  wsConnected: boolean;
  reconnectCount: number;
  lastMessageAt?: string;
  lastHeartbeatAt?: string;
  receivedCount: number;
  publishedCount: number;
  publishErrorCount: number;
  parseErrorCount: number;
  startedAt: string;
};
