import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { runApproversCli } from "../../src/permissions/index.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { poll } from "../support/helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

/** The parsed arguments, or what the parser refused with: a wrong parse fails an assertion. */
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: (error as Error).message };
  }
}

const key = (over: Record<string, unknown> = {}) => ({
  keyId: "k1",
  name: "Ana's phone",
  client: "flightdeck-app",
  address: "100.64.0.7",
  enrolledAt: "2026-11-20T12:00:00.000Z",
  ...over,
});
const list = (keys: unknown[]) => ({
  daemonId: "d1",
  protectionOff: keys.length === 0,
  keys,
});
const enrolled = (over: Record<string, unknown> = {}) => ({
  type: "approval.enrolled",
  ...key(),
  ...over,
});
const revoked = { type: "approval.revoked", keyId: "k1" };

/** Runs `approvers watch --follow` once the daemon has the watch, then presses Ctrl-C when `lines` lines came. */
async function followed(
  daemon: ReturnType<typeof fakeDaemon>,
  options: { json?: boolean; lines?: number; after?: () => unknown } = {},
) {
  const lines: string[] = [];
  const stop = new AbortController();
  const running = runApproversCli(
    { follow: true, ...(options.json ? { json: true } : {}) },
    config(daemon.port),
    { timeoutMs: 2000, signal: stop.signal, write: (l) => lines.push(l) },
  );
  await poll(() => daemon.calls.some((c) => c.type === "approval.watch"));
  await options.after?.();
  await poll(() => lines.length >= (options.lines ?? 1));
  stop.abort();
  return { result: await running, lines };
}

describe("flightdeckd approvers watch, once (issue #3476)", () => {
  test("it prints a line for each device that can approve, from approval.list, and sends nothing else", async () => {
    const daemon = fakeDaemon({
      "approval.list": () =>
        list([key(), key({ keyId: "k2", name: "Laptop", address: "100.64.0.9" })]),
    });
    const result = await runApproversCli({}, config(daemon.port));
    expect(result).toEqual({
      code: 0,
      out: [
        "k1  Ana's phone  flightdeck-app  100.64.0.7  2026-11-20T12:00:00.000Z",
        "k2  Laptop  flightdeck-app  100.64.0.9  2026-11-20T12:00:00.000Z",
      ],
      err: [],
    });
    expect(daemon.calls.map((c) => c.type)).toEqual(["hello", "approval.list"]);
  });

  test("with no device it says protection is off", async () => {
    const daemon = fakeDaemon({ "approval.list": () => list([]) });
    const result = await runApproversCli({}, config(daemon.port));
    expect(result).toEqual({
      code: 0,
      out: ["no device enrolled: protection is off"],
      err: [],
    });
  });

  test("--json prints the daemon's list", async () => {
    const answer = list([key()]);
    const daemon = fakeDaemon({ "approval.list": () => answer });
    const result = await runApproversCli({ json: true }, config(daemon.port));
    expect(result.out).toEqual([JSON.stringify(answer, null, 2)]);
  });

  test("a device name cannot drive the terminal", async () => {
    const daemon = fakeDaemon({ "approval.list": () => list([key({ name: "a\u001b[2Jb" })]) });
    const result = await runApproversCli({}, config(daemon.port));
    expect(result.out.join("\n")).toContain("a [2Jb");
    expect(result.out.join("\n")).not.toContain("\u001b");
  });

  test("a host that does not run approvals exits 1 with its refusal; no daemon exits 2", async () => {
    const off = fakeDaemon({
      "approval.list": () => ({ error: { code: "feature_off", message: "approvalProof is off" } }),
    });
    const refused = await runApproversCli({}, config(off.port));
    expect(refused.code).toBe(1);
    expect(refused.err.join("\n")).toContain("feature_off");
    const silent = fakeDaemon({});
    const none = await runApproversCli({}, config(silent.port), { timeoutMs: 200 });
    expect(none.code).toBe(2);
  });
});

describe("flightdeckd approvers watch --follow (issue #3476)", () => {
  test("it writes a line for each device enrolled or revoked, and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "approval.watch": () => ({}) });
    const { result, lines } = await followed(daemon, {
      lines: 2,
      after: () => {
        daemon.push(enrolled());
        daemon.push(revoked);
      },
    });
    expect(lines).toEqual([
      "enrolled  k1  Ana's phone  flightdeck-app  100.64.0.7  2026-11-20T12:00:00.000Z",
      "revoked  k1",
    ]);
    expect(result.code).toBe(0);
    expect(daemon.calls.filter((c) => c.type === "approval.watch")).toHaveLength(1);
    expect(daemon.calls.some((c) => c.type === "approval.list")).toBe(false);
  });

  test("--json writes one object per line, with the type and the same fields", async () => {
    const daemon = fakeDaemon({ "approval.watch": () => ({}) });
    const { lines } = await followed(daemon, {
      json: true,
      lines: 2,
      after: () => {
        daemon.push(enrolled());
        daemon.push(revoked);
      },
    });
    expect(lines.map((l) => JSON.parse(l))).toEqual([enrolled(), revoked]);
    expect(lines.every((l) => !l.includes("\n"))).toBe(true);
  });

  test("a frame that carries more than the event says is cut to the event's fields", async () => {
    const daemon = fakeDaemon({ "approval.watch": () => ({}) });
    const { lines } = await followed(daemon, {
      json: true,
      after: () => daemon.push(enrolled({ publicKey: "SECRET-KEY", nonce: "SECRET-NONCE" })),
    });
    expect(lines).toHaveLength(1);
    expect(lines.join("\n")).not.toContain("SECRET");
  });

  test("a device name cannot drive the terminal", async () => {
    const daemon = fakeDaemon({ "approval.watch": () => ({}) });
    const { lines } = await followed(daemon, {
      after: () => daemon.push(enrolled({ name: "a\u001b[2Jb" })),
    });
    expect(lines.join("\n")).toContain("a [2Jb");
    expect(lines.join("\n")).not.toContain("\u001b");
  });

  test("a host that does not know the watch exits 1 with its refusal", async () => {
    const daemon = fakeDaemon({
      "approval.watch": () => ({ error: { code: "invalid", message: "unknown command" } }),
    });
    const { result } = await followed(daemon, { lines: 0 });
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("unknown command");
  });

  test("a daemon that goes away mid-stream exits 2, after what it had written", async () => {
    const daemon = fakeDaemon({ "approval.watch": () => ({}) });
    const lines: string[] = [];
    let code: number | undefined;
    void runApproversCli({ follow: true }, config(daemon.port), {
      timeoutMs: 2000,
      signal: new AbortController().signal,
      write: (l) => lines.push(l),
    }).then((r) => {
      code = r.code;
    });
    await poll(() => daemon.calls.some((c) => c.type === "approval.watch"));
    daemon.push(enrolled());
    await poll(() => lines.length === 1);
    daemon.dropAll();
    await poll(() => code !== undefined);
    expect(code).toBe(2);
  });
});

describe("the arguments of approvers watch (issue #3476)", () => {
  test("watch takes --follow and --json", () => {
    expect(parsed(["approvers", "watch"])).toMatchObject({ command: "approvers", action: "watch" });
    expect(parsed(["approvers", "watch", "--follow", "--json"])).toMatchObject({
      action: "watch",
      follow: true,
      json: true,
    });
  });

  test("--follow belongs to watch only", () => {
    for (const argv of [
      ["approvers", "enroll", "--follow"],
      ["approvers", "reset", "--follow"],
      ["history", "watch", "--follow"],
      ["card", "list", "--follow"],
    ])
      expect(parsed(argv)).toMatchObject({
        refusedWith: expect.stringContaining(
          "--follow: this flag only applies to flightdeckd approvers watch",
        ),
      });
  });

  test("enroll and reset stay as they were, and an unknown verb is still refused", () => {
    expect(parsed(["approvers", "enroll"])).toMatchObject({ action: "enroll" });
    expect(parsed(["approvers", "reset", "--json"])).toMatchObject({ action: "reset", json: true });
    expect(parsed(["approvers", "revoke"])).toMatchObject({
      refusedWith: expect.stringContaining("invalid approvers action"),
    });
  });
});

describe("approvers watch through the command line (issue #3476)", () => {
  test("it runs through flightdeckd and prints the devices", async () => {
    const daemon = fakeDaemon({ "approval.list": () => list([key()]) });
    const run = await flightdeckd(["approvers", "watch"], daemon.port);
    expect(run.out).toEqual([
      "k1  Ana's phone  flightdeck-app  100.64.0.7  2026-11-20T12:00:00.000Z",
    ]);
    expect(run.code).toBe(0);
  });

  test("with no daemon it exits 2", async () => {
    const daemon = fakeDaemon({});
    const port = daemon.port;
    await stopAll();
    const run = await flightdeckd(["approvers", "watch"], port);
    expect(run.code).toBe(2);
  });
});
