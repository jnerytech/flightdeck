/** What a frame needs of a socket (Bun's `ServerWebSocket`). */
export interface FrameSocket {
  /** Bytes sent, -1 when queued under backpressure, 0 when the frame was dropped. */
  send(data: string): number;
  terminate(): void;
  data: { dropped?: boolean };
}

/** Sends one frame to a client. */
export function sendFrame(ws: FrameSocket, message: unknown): void {
  ws.send(JSON.stringify(message));
}
