import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import { poll, tempDir } from "./helpers.ts";

const TOKEN = "doctor-daemon-token-0123456789";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

describe("doctor-host: the running daemon", () => {
  test("answers doctor.run about itself: its folders, its version, and the app it talks to", async () => {
    const dir = tempDir("fd-doctor-daemon-");
    const gone = join(dir, "gone");
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        hostName: "h",
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [dir, gone],
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    stops.push(() => daemon.stop());
    const ws = new WebSocket(daemon.url);
    const acks: protocol.Ack[] = [];
    ws.addEventListener("message", (m) => {
      const msg = protocol.parseServerMessage(String(m.data));
      if (msg.type === "ack") acks.push(msg);
    });
    await new Promise((r) => ws.addEventListener("open", r));
    ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
    ws.send(JSON.stringify({ id: "2", type: "doctor.run", payload: { appVersion: "0.1.0" } }));
    const ack = await poll(() => acks.find((a) => a.id === "2"), 4000);
    ws.close();
    expect(ack?.ok).toBe(true);
    const result = (ack?.ok ? ack.data : null) as protocol.DoctorResult;
    const by = (id: string) => result.checks.find((check) => check.id === id);
    expect(by("folders")).toMatchObject({ status: "fail" });
    expect(by("folders")?.detail).toContain(gone);
    expect(by("daemon")).toMatchObject({ status: "ok" });
    expect(by("version")).toMatchObject({ status: "warn" });
    expect(result.ok).toBe(false);
  });
});
