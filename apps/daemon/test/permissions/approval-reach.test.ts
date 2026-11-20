import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import { Central } from "../../src/central/central.ts";
import { FlightdeckError } from "../../src/kernel/errors.ts";
import { Approvers } from "../../src/permissions/approvers.ts";
import { keyIdOf } from "../../src/permissions/domain/approval-gate.ts";
import { RiskClassifier } from "../../src/permissions/domain/risk.ts";
import { createPermissions } from "../../src/permissions/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { newManager, poll, tempDir } from "../support/helpers.ts";

/**
 * What main.ts builds (#3439): the permission domain makes the approvers once and hands their gate to
 * the session manager and to the hub of the terminal sessions, so a signed proof guards both paths.
 */
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const reasonOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof FlightdeckError) return error.reason;
    throw error;
  }
  return null;
};

function permissions() {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  const built = createPermissions({
    db: store.db,
    runtime: { judgePermission: async () => ({ decision: "ask", reason: "x" }) },
    config: { allowedRoots: ["/p"], dataDir: "/data", risk: { extraHigh: [] } },
    home: "/home/u",
    projectForCwd: () => null,
    usage: { record: () => undefined },
  });
  return { store, ...built };
}

/** Enrolls a device the way the store keeps it; the proof itself is tested in approvers and the handlers. */
function enroll(approvers: ReturnType<typeof permissions>["approvers"]) {
  const spki = generateKeyPairSync("ec", { namedCurve: "P-256" })
    .publicKey.export({ type: "spki", format: "der" })
    .toString("base64");
  approvers.store.add({
    keyId: keyIdOf(spki),
    publicKey: spki,
    name: "phone",
    client: "app",
    address: "127.0.0.1",
    enrolledAt: new Date().toISOString(),
  });
}

describe("approval-reach: the permission domain builds the approvers once, for the server and the gates", () => {
  test("Given the permission domain, Then its server module carries the approvers", () => {
    const { modules, approvers } = permissions();
    expect((modules[0].server as { approvers?: unknown }).approvers === approvers).toBe(true);
  });

  test("Given two builds on one database, Then the daemon id is the same", () => {
    const { store, approvers } = permissions();
    const again = createPermissions({
      db: store.db,
      runtime: { judgePermission: async () => ({ decision: "ask", reason: "x" }) },
      config: { allowedRoots: ["/p"], dataDir: "/data", risk: { extraHigh: [] } },
      home: "/home/u",
      projectForCwd: () => null,
      usage: { record: () => undefined },
    });
    expect(again.approvers.daemonId()).toBe(approvers.daemonId());
  });
});

describe("approval-reach: the approvers read the real clock and randomness when no one injects them", () => {
  test("Given no options, Then the daemon id and a challenge's nonce are made, and the two clocks read", () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const approvers = new Approvers(store.db);
    expect(() => approvers.daemonId()).not.toThrow();
    expect(approvers.daemonId().length).toBeGreaterThanOrEqual(32);
    const challenge = approvers.challenge("enroll", undefined, 1);
    expect(challenge.nonce.length).toBeGreaterThan(0);
    expect(challenge.expiresInMs).toBe(60_000);
  });

  test("Given the board's project lookup, Then the automatic approval asks it for the cwd and the card", async () => {
    const asked: string[] = [];
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const { autoApprove } = createPermissions({
      db: store.db,
      runtime: { judgePermission: async () => ({ decision: "ask", reason: "x" }) },
      config: { allowedRoots: ["/p"], dataDir: "/data", risk: { extraHigh: [] } },
      home: "/home/u",
      projectForCwd: (cwd) => {
        asked.push(cwd);
        return cwd === "/p/card"
          ? {
              project: {
                id: "p1",
                autoApprove: { enabled: false, model: "m", lowWithoutAi: false },
              },
              card: { id: "c1", description: "d" },
            }
          : null;
      },
      usage: { record: () => undefined },
    });
    const request = {
      sessionKey: "s",
      requestId: "r",
      toolName: "Bash",
      input: {},
      risk: { level: "low" as const, reason: "x", network: false },
    };
    expect(await autoApprove.decide({ ...request, cwd: "/elsewhere" })).toBeNull();
    expect(await autoApprove.decide({ ...request, cwd: "/p/card" })).toBeNull();
    expect(asked).toEqual(["/elsewhere", "/p/card"]);
  });
});

describe("approval-reach: a gate handed to the session manager guards a managed session's allow", () => {
  test("Given a key, When a managed session's allow saves a rule with no proof, Then it is refused and the request stays open", async () => {
    const { approvers } = permissions();
    enroll(approvers);
    const { manager, project, store } = newManager({ approval: approvers.gate });
    const { sessionId } = await manager.create({ cwd: project, prompt: "[bash] y" });
    const requestId = await poll(() => store.pendingPermissions(sessionId)[0]?.id);
    expect(
      reasonOf(() =>
        manager.respondPermission({
          requestId: requestId ?? "",
          decision: "allow",
          updatedPermissions: [
            {
              type: "addRules",
              rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
              behavior: "allow",
              destination: "localSettings",
            },
          ],
        }),
      ),
    ).toBe("approval_proof_required");
    expect(store.pendingPermissions(sessionId).length).toBe(1);
  });
});

describe("approval-reach: a gate handed to the hub guards an external session's allow", () => {
  test("Given a key, When a held `rm -rf` is allowed with only the hold, Then it is refused and the hook stays held", async () => {
    const { approvers } = permissions();
    enroll(approvers);
    const { manager, store } = newManager();
    const central = new Central({
      db: store.db,
      manager,
      risk: new RiskClassifier({ allowedRoots: ["/p"], home: "/home/u" }),
      approval: approvers.gate,
      hooks: { port: 0, permissionTimeoutS: 600, staleAfterS: 900 },
      dataDir: join(tempDir(), "data"),
      hostName: "h",
      configFile: join(tempDir(), "config.json"),
      selfCommand: ["flightdeckd"],
      settingsPath: () => join(tempDir(), "settings.json"),
    });
    cleanups.push(() => central.stop());
    central.permissions.watch(() => {});
    const held = central.permissions.hold(
      {
        session_id: "s1",
        hook_event_name: "PermissionRequest",
        cwd: "/p",
        tool_name: "Bash",
        tool_input: { command: "rm -rf build" },
      },
      new AbortController().signal,
    );
    held.catch(() => {});
    const requestId = central.permissions.open()[0]?.requestId ?? "";
    expect(reasonOf(() => central.permissions.respond(requestId, "allow", { held: true }))).toBe(
      "approval_proof_required",
    );
    expect(central.permissions.open().length).toBe(1);
  });
});
