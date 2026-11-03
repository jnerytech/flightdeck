import { afterEach, describe, expect, test } from "bun:test";
import * as protocol from "@flightdeck/protocol";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";

const TOKEN = "doctor-run-token-0123456789";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

async function ask(server: RunningServer, type: string, payload: object) {
  const ws = new WebSocket(server.url);
  const acks: protocol.Ack[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
  ws.send(JSON.stringify({ id: "2", type, payload }));
  const ack = await poll(() => acks.find((a) => a.id === "2"), 2000);
  ws.close();
  return ack;
}

const report: protocol.DoctorResult = {
  ok: false,
  checks: [
    {
      id: "claude",
      status: "warn",
      detail: "claude is not on the PATH",
      fix: "install Claude Code",
    },
  ],
};

function server(doctor?: (appVersion?: string) => Promise<protocol.DoctorResult>) {
  const started = startServer({
    manager: newManager().manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    ...(doctor ? { doctor } : {}),
  });
  stops.push(() => started.stop());
  return started;
}

describe("doctor-run: the doctor.run command", () => {
  test("the payload takes the app version, and nothing else", () => {
    const parse = (payload: object) =>
      protocol.Command.safeParse({ id: "1", type: "doctor.run", payload }).success;
    expect(parse({})).toBe(true);
    expect(parse({ appVersion: "0.32.0" })).toBe(true);
    expect(parse({ appVersion: 32 })).toBe(false);
    expect(parse({ other: 1 })).toBe(false);
  });

  test("the host answers with its report, given the app version it was asked with", async () => {
    const seen: Array<string | undefined> = [];
    const running = server(async (appVersion) => {
      seen.push(appVersion);
      return report;
    });
    const ack = await ask(running, "doctor.run", { appVersion: "0.32.0" });
    expect(ack?.ok && ack.data).toEqual(report);
    expect(seen).toEqual(["0.32.0"]);
  });

  test("host.info announces doctor.run only when the daemon can run it", async () => {
    const info = await ask(
      server(async () => report),
      "host.info",
      {},
    );
    expect(info?.ok && (info.data as { features: string[] }).features).toContain("doctor.run");
    const bare = await ask(server(), "host.info", {});
    expect(bare?.ok && (bare.data as { features: string[] }).features).toEqual([]);
    const refused = await ask(server(), "doctor.run", {});
    expect(refused && !refused.ok && refused.error.reason).toBe("feature_off");
  });
});
