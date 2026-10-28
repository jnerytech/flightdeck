import {
  CLOSE_UNAUTHORIZED,
  type HelloResult,
  type HostInfoResult,
  parseServerMessage,
} from "@flightdeck/protocol";

export type ProbeResult =
  | { ok: true; info: HelloResult & HostInfoResult }
  | { ok: false; error: string };

/**
 * One-shot check before saving a host: connects, sends `hello` and `host.info`, then closes.
 * Resolves with the daemon's data or a short reason (bad token, unreachable, daemon error).
 */
export function probeHost(url: string, token: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let hello: HelloResult | null = null;
    let settled = false;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      ws.close();
      resolve(result);
    };
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: "hello", type: "hello", payload: { token, client: "probe" } }));
    });
    ws.addEventListener("message", (msg) => {
      const message = parseServerMessage(String(msg.data));
      if (message.type !== "ack") return;
      if (!message.ok) return finish({ ok: false, error: message.error.message });
      if (message.id === "hello") {
        hello = message.data as HelloResult;
        ws.send(JSON.stringify({ id: "info", type: "host.info", payload: {} }));
        return;
      }
      finish({
        ok: true,
        info: { ...(hello as HelloResult), ...(message.data as HostInfoResult) },
      });
    });
    ws.addEventListener("close", (event) =>
      finish({
        ok: false,
        error: event.code === CLOSE_UNAUTHORIZED ? "token recusado" : "não foi possível conectar",
      }),
    );
  });
}
