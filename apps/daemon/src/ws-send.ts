/** What a frame needs of a socket (Bun's `ServerWebSocket`). */
export interface FrameSocket {
  /** Bytes sent, -1 when queued under backpressure, 0 when the frame was dropped. */
  send(data: string): number;
  terminate(): void;
  data: { dropped?: boolean };
}

/**
 * Sends one frame to a client. A frame Bun drops (0: the client's buffer is over the limit)
 * would leave a hole in what the client has seen, so that client is cut off at once and gets
 * nothing more: it reconnects and resumes from its last seq. `terminate`, not `close`: a close
 * frame cannot reach a peer that stopped reading, which is how the buffer filled.
 */
export function sendFrame(ws: FrameSocket, message: unknown): void {
  if (ws.data.dropped) return;
  if (ws.send(JSON.stringify(message)) === 0) {
    ws.data.dropped = true;
    ws.terminate();
  }
}
