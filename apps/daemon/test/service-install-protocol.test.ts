import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import type { ServiceContext } from "../src/service.ts";
import { poll, tempDir } from "./helpers.ts";

const TOKEN = "service-install-token-0123456789";
const STABLE = "/h/.flightdeck/bin/flightdeckd";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/** A Linux service manager with no unit yet and linger off: it records, and nothing real runs. */
function manager() {
  const calls: string[][] = [];
  const written: string[] = [];
  const ctx = (dryRun: boolean): ServiceContext => ({
    platform: "linux",
    home: "/h",
    user: "u",
    command: ["/somewhere/else"],
    systemRoot: "",
    tempDir: "/tmp",
    dryRun,
    exec: async (cmd) => {
      calls.push(cmd);
      if (cmd.includes("loginctl")) return { code: 0, stdout: "Linger=no\n" };
      return { code: cmd.includes("cat") ? 1 : 0, stdout: "" };
    },
    writeFile: (path) => {
      written.push(path);
    },
    removeFile: () => {},
    which: (name) => ({ systemctl: "/usr/bin/systemctl", claude: "/opt/claude" })[name] ?? null,
  });
  return { ctx, calls, written };
}

async function daemonWith(options: Parameters<typeof startDaemon>[3]) {
  const dir = tempDir("fd-service-install-");
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      hostName: "h",
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [dir],
    }),
  );
  const daemon = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
    options,
  );
  stops.push(() => daemon.stop());
  const ws = new WebSocket(daemon.url);
  const messages: protocol.ServerMessage[] = [];
  ws.addEventListener("message", (m) => messages.push(protocol.parseServerMessage(String(m.data))));
  await new Promise((r) => ws.addEventListener("open", r));
  stops.push(async () => ws.close());
  let next = 0;
  const call = async (type: string, payload: unknown) => {
    const id = `c${++next}`;
    ws.send(JSON.stringify({ id, type, payload }));
    return poll(
      () => messages.find((m): m is protocol.Ack => m.type === "ack" && m.id === id),
      4000,
    );
  };
  const hello = await call("hello", { token: TOKEN, client: "t" });
  const features =
    ((hello?.ok ? hello.data : null) as { features?: string[] } | null)?.features ?? [];
  return { call, features, file };
}

describe("service.install over the protocol (#1200)", () => {
  test("a daemon run as its stable binary offers it, refuses it without confirm, and installs it enabled for the next login", async () => {
    const os = manager();
    const d = await daemonWith({ serviceContext: os.ctx, serviceSelf: [STABLE] });
    expect(d.features.includes(protocol.FEATURE_SERVICE_INSTALL)).toBe(true);

    const refused = await d.call("service.install", {});
    expect(refused?.ok ? "ok" : (refused?.error.reason ?? "")).toBe("service_confirm");
    expect(os.written).toEqual([]);

    const done = await d.call("service.install", { confirm: true });
    expect(done?.ok ? done.data : done?.error.message).toEqual({
      startsAt: "logon",
      lingerOff: true,
      user: "u",
    });
    expect(os.written).toEqual(["/h/.config/systemd/user/flightdeckd.service"]);
    const ran = os.calls.map((c) => c.join(" "));
    expect(ran).toContain("systemctl --user enable flightdeckd");
    expect(ran.filter((c) => c.includes("--now") || c.includes("sudo"))).toEqual([]);
    expect(JSON.parse(readFileSync(d.file, "utf8")).claude?.executablePath ?? "").toBe(
      "/opt/claude",
    );
  });

  test("a daemon run from source (the demo, the journeys) neither offers it nor runs it", async () => {
    const os = manager();
    const d = await daemonWith({
      serviceContext: os.ctx,
      serviceSelf: ["/usr/bin/bun", "run", "/repo/main.ts"],
    });
    expect(d.features.includes(protocol.FEATURE_SERVICE_INSTALL)).toBe(false);
    const refused = await d.call("service.install", { confirm: true });
    expect(refused?.ok ? "ok" : (refused?.error.code ?? "")).toBe("feature_off");
    expect(os.written).toEqual([]);
  });
});
