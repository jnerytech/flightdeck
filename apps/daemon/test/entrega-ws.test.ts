import { describe, expect, test } from "bun:test";
import { type FrameSocket, sendFrame } from "../src/ws-send.ts";

/** A socket whose `send` answers what the test says, one answer per call. */
function socket(answers: number[]) {
  const sent: string[] = [];
  let terminated = 0;
  const ws: FrameSocket = {
    send: (data) => {
      sent.push(data);
      return answers.shift() ?? 10;
    },
    terminate: () => void terminated++,
    data: {},
  };
  return { ws, sent, terminated: () => terminated };
}

describe("entrega-ws: a client never sees a gap", () => {
  test("a frame that went out is sent as JSON and nothing else happens", () => {
    const s = socket([12]);
    sendFrame(s.ws, { type: "event", seq: 1 });
    expect(s.sent).toEqual(['{"type":"event","seq":1}']);
    expect(s.terminated()).toBe(0);
  });

  test("a frame queued under backpressure (-1) is on its way: the client is not cut off and the next frame goes", () => {
    const s = socket([-1, -1, 9]);
    for (const seq of [1, 2, 3]) sendFrame(s.ws, { seq });
    expect(s.sent).toHaveLength(3);
    expect(s.terminated()).toBe(0);
  });

  test("a frame that was dropped (0) cuts the client off, so it reconnects and resumes from its last seq", () => {
    const s = socket([9, 0]);
    sendFrame(s.ws, { seq: 1 });
    sendFrame(s.ws, { seq: 2 });
    expect(s.terminated()).toBe(1);
  });

  test("after a drop, no later frame reaches that client: it would be a gap", () => {
    const s = socket([9, 0, 9, 9]);
    for (const seq of [1, 2, 3, 4]) sendFrame(s.ws, { seq });
    expect(s.sent).toEqual(['{"seq":1}', '{"seq":2}']);
    expect(s.terminated()).toBe(1);
    expect(s.ws.data.dropped).toBe(true);
  });
});
