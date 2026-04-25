export type FastConnectPayload = Record<string, unknown>;

export type NormalizedEventSource = "ssi-fastconnect" | "ssi-fastconnect-sim";

export type NormalizedOhlcv = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  value: number;
  tradingTime: string;
  tickTime: string;
};

export type NormalizedEvent = {
  symbol: string;
  price: number;
  ts: string;
  seq: number;
  source: NormalizedEventSource;
  isHeartbeat: boolean;
  marketStatus: string;
  channel: string;
  barTs?: string;
  ohlcv?: NormalizedOhlcv;
};

export type ForeignTransactionSnapshot = {
  symbol: string;
  tradeDate: string;
  tradingTime?: string;
  ts: string;
  seq: number;
  source: NormalizedEventSource;
  marketStatus: string;
  channel: "R";
  totalRoom: number;
  currentRoom?: number;
  buyVol: number;
  sellVol: number;
  buyVal: number;
  sellVal: number;
  marketId?: string;
  exchange?: string;
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
