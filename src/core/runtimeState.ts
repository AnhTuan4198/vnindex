import type { RuntimeState } from "./types.js";

export class RuntimeStateStore {
  private state: RuntimeState = {
    wsConnected: false,
    reconnectCount: 0,
    receivedCount: 0,
    publishedCount: 0,
    publishErrorCount: 0,
    parseErrorCount: 0,
    startedAt: new Date().toISOString()
  };

  snapshot(): RuntimeState {
    return { ...this.state };
  }

  setWsConnected(connected: boolean): void {
    this.state.wsConnected = connected;
  }

  incrementReconnect(): void {
    this.state.reconnectCount += 1;
  }

  markMessageReceived(): void {
    this.state.receivedCount += 1;
    this.state.lastMessageAt = new Date().toISOString();
  }

  markHeartbeatPublished(): void {
    this.state.lastHeartbeatAt = new Date().toISOString();
  }

  incrementPublished(): void {
    this.state.publishedCount += 1;
  }

  incrementPublishError(): void {
    this.state.publishErrorCount += 1;
  }

  incrementParseError(): void {
    this.state.parseErrorCount += 1;
  }
}
