import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BgService } from "../src/bg/service.ts";
import { Central } from "../src/central/central.ts";
import { FlightdeckError } from "../src/errors.ts";
import { PermissionBroker } from "../src/permissions/permission-broker.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { TerminalManager } from "../src/terminal/terminal-manager.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { fakePtys } from "./pty-helpers.ts";

const TOKEN = "resto-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The code, reason and params of the refusal a call ends in. */
async function refused(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    const { code, reason, params } = error as FlightdeckError;
    return { code, reason, params };
  }
  throw new Error("it did not refuse");
}

describe("recusas-resto: the services", () => {
  test("a permission request that is not open", async () => {
    const store = new EventStore(":memory:");
    const broker = new PermissionBroker(store, {
      emit: () => {},
      onPendingChange: () => {},
      classify: () => "low" as never,
    });
    expect(
      await refused(() => broker.respond({ requestId: "gone", decision: "allow" } as never)),
    ).toEqual({
      code: "not_found",
      reason: "permission_request_closed",
      params: { id: "gone" },
    });
  });

  test("a background session for a card that does not exist", async () => {
    const bg = new BgService({
      db: new EventStore(":memory:").db,
      claude: () => "claude",
      start: { self: ["flightdeckd"], configFile: "/c", allowedRoots: [] },
      card: () => null as never,
    });
    expect(await refused(() => bg.start({ cardId: "nope" }))).toEqual({
      code: "not_found",
      reason: "card_not_found",
      params: { id: "nope" },
    });
  });

  test("changing the host's Claude settings needs confirm", async () => {
    const { manager, store } = newManager();
    const dir = tempDir();
    const configFile = join(dir, "config.json");
    writeFileSync(configFile, "{}");
    const central = new Central({
      db: store.db,
      manager,
      hooks: { port: 0, permissionTimeoutS: 600, staleAfterS: 900 },
      dataDir: join(dir, "data"),
      hostName: "h",
      configFile,
      selfCommand: ["flightdeckd"],
      settingsPath: () => join(dir, "settings.json"),
    });
    cleanups.push(() => central.stop());
    expect(await refused(() => central.hooksInstall(false))).toEqual({
      code: "invalid_state",
      reason: "central_confirm",
      params: undefined,
    });
    expect((await refused(() => central.hooksUninstall(false))).reason).toBe("central_confirm");
  });
});

describe("recusas-resto: the server", () => {
  async function connect(extra: Record<string, unknown> = {}) {
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      ...extra,
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return client;
  }
  const why = (ack: Record<string, unknown>) =>
    (ack.error ?? {}) as { code?: string; reason?: string; params?: Record<string, unknown> };

  test("a host without PR watch or run environment names the feature", async () => {
    const client = await connect();
    expect(why(await client.request("watch.get", { cardId: "c" }))).toMatchObject({
      code: "invalid_state",
      reason: "feature_off",
      params: { feature: "prWatch" },
    });
    expect(why(await client.request("runenv.get", { cardId: "c" }))).toMatchObject({
      reason: "feature_off",
      params: { feature: "runEnv" },
    });
  });

  test("turning the terminal on and resuming auto-approval need confirm", async () => {
    const ptys = fakePtys();
    const terminals = new TerminalManager({
      pty: ptys.factory,
      allowedRoots: [],
      enabled: false,
      platform: "linux",
      env: () => ({ SHELL: "/bin/zsh" }),
      log: () => {},
    });
    cleanups.push(() => terminals.stop());
    const client = await connect({
      terminals,
      autoApprove: { suspended: () => [], list: () => [], resume: () => {} },
    });
    expect(
      why(await client.request("terminal.settings", { enabled: true, confirm: false })).reason,
    ).toBe("terminal_enable_confirm");
    expect(
      why(await client.request("autoapprove.resume", { sessionKey: "s", confirm: false })).reason,
    ).toBe("autoapprove_resume_confirm");
  });
});
