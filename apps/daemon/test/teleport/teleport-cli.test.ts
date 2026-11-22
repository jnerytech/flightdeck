import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runTeleportCli } from "../../src/teleport/index.ts";
import {
  config,
  fakeDaemon,
  type Handlers,
  TOKEN as LOCAL_TOKEN,
  stopAll,
} from "../board/card-cli-helpers.ts";
import { machine, me, TOKEN as TARGET_TOKEN } from "../remote-hosts/machine.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const b64 = (text: string) => Buffer.from(text).toString("base64");

const MANIFEST = {
  id: "pkg-1",
  sessionId: "s1",
  claudeSessionId: "claude-1",
  cwd: "/work/api",
  model: "claude-sonnet-5-5",
  permissionMode: "default",
  persona: "dev",
  expiresAt: "2026-11-21T12:00:00.000Z",
  parts: [
    { name: "transcript", size: 10, sha256: "a".repeat(64) },
    { name: "code", size: 4, sha256: "b".repeat(64) },
  ],
  secrets: { lines: 2, labels: ["aws-access-key"] },
  git: {
    branch: "feat/x",
    head: "c".repeat(40),
    base: "origin/main",
    baseSha: "d".repeat(40),
    ref: "refs/teleport/pkg-1",
    ahead: 2,
    changed: 3,
  },
};

const SUMMARY = {
  model: "claude-sonnet-5-5",
  permissionMode: "default",
  persona: "dev",
  parts: [
    { name: "transcript", size: 10 },
    { name: "code", size: 4 },
  ],
  git: { branch: "feat/x", ahead: 2, changed: 3 },
  secrets: { lines: 2, labels: ["aws-access-key"] },
};

const CHUNKS: Record<string, Record<number, unknown>> = {
  transcript: {
    0: { data: b64("hello"), next: 5, eof: false },
    5: { data: b64("world"), next: 10, eof: true },
  },
  code: { 0: { data: b64("code"), next: 4, eof: true } },
};

/** The source host: an idle session, a package, and what it frees. */
const SOURCE: Handlers = {
  "session.list": () => ({
    sessions: [{ id: "s1", name: "api", status: "idle", claudeSessionId: "claude-1" }],
  }),
  "teleport.prepare": () => MANIFEST,
  "teleport.read": (p) => CHUNKS[p.part as string]?.[p.offset as number],
  "teleport.cancel": () => ({}),
  "session.meta.set": () => ({}),
};

/** The target host: it takes the package and imports it. */
const TARGET: Handlers = {
  "teleport.receive": () => ({ id: "recv-1" }),
  "teleport.write": (p) => ({ written: (p.offset as number) + 1 }),
  "teleport.abort": () => ({}),
  "teleport.finish": () => ({
    sessionId: "t-s1",
    worktree: "/srv/api-wt",
    branch: "tp/x",
  }),
};

/** What a host was asked, past its `hello`. */
const asked = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type !== "hello").map((c) => [c.type, c.payload]);
const types = (daemon: ReturnType<typeof fakeDaemon>) => asked(daemon).map(([type]) => type);

const ARGV = ["session", "teleport", "api", "--to", "server", "--repo", "/srv/api"];

/** `fd session teleport` from this machine's daemon (the source) to the paired host "server" (the target). */
async function move(
  extra: string[],
  source: Handlers = SOURCE,
  target: Handlers = TARGET,
  argv: string[] = ARGV,
) {
  const src = fakeDaemon(source);
  const dst = fakeDaemon(target, TARGET_TOKEN);
  const m = machine({ url: `ws://127.0.0.1:${dst.port}/v1/ws` });
  const run = await flightdeckd([...argv, ...extra], src.port, undefined, { remote: m.deps });
  return { run, src, dst, text: [...run.out, ...run.err].join("\n") };
}

const printed = (out: string[]) => JSON.parse(out.join("\n")) as Record<string, unknown>;

describe.skipIf(me === null)("flightdeckd session teleport (issue #3704)", () => {
  test("--confirm moves the session chunk by chunk, imports it on the target, and archives the source copy", async () => {
    const { run, src, dst } = await move(["--confirm", "--json"]);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(printed(run.out)).toEqual({
      moved: true,
      id: "pkg-1",
      sessionId: "t-s1",
      claudeSessionId: "claude-1",
      target: "server",
      worktree: "/srv/api-wt",
      branch: "tp/x",
    });
    expect(asked(dst)).toEqual([
      ["teleport.receive", { manifest: MANIFEST }],
      ["teleport.write", { id: "recv-1", part: "transcript", offset: 0, data: b64("hello") }],
      ["teleport.write", { id: "recv-1", part: "transcript", offset: 5, data: b64("world") }],
      ["teleport.write", { id: "recv-1", part: "code", offset: 0, data: b64("code") }],
      ["teleport.finish", { id: "recv-1", repo: "/srv/api" }],
    ]);
    expect(asked(src)).toEqual([
      ["session.list", {}],
      ["teleport.prepare", { sessionId: "s1" }],
      ["teleport.read", { id: "pkg-1", part: "transcript", offset: 0 }],
      ["teleport.read", { id: "pkg-1", part: "transcript", offset: 5 }],
      ["teleport.read", { id: "pkg-1", part: "code", offset: 0 }],
      ["teleport.cancel", { id: "pkg-1" }],
      ["session.meta.set", { claudeSessionId: "claude-1", archived: true }],
    ]);
  });

  test("the text form prints what the app's dialog shows, then the result, with progress on stderr", async () => {
    const { run } = await move(["--confirm"]);
    expect(run.code).toBe(0);
    const text = run.out.join("\n");
    for (const part of [
      "api",
      "claude-sonnet-5-5",
      "default",
      "dev",
      "transcript 10 B",
      "code 4 B",
      "feat/x",
      "2 commits ahead",
      "3 files changed",
      "2 lines",
      "aws-access-key",
    ])
      expect(text).toContain(part);
    expect(run.out.at(-1)).toContain("moved api to server");
    expect(run.out.at(-1)).toContain("t-s1");
    expect(run.err.at(-1)).toBe("sent 14 of 14 bytes");
  });

  test("without --confirm nothing moves: the summary is printed, the source package is dropped, exit 1", async () => {
    const { run, src, dst } = await move([]);
    expect(run.code).toBe(1);
    expect(run.out.join("\n")).toContain("aws-access-key");
    expect(run.err.join("\n")).toContain("--confirm");
    expect(types(dst)).toEqual([]);
    expect(asked(src).slice(-1)).toEqual([["teleport.cancel", { id: "pkg-1" }]]);
    expect(types(src)).not.toContain("session.meta.set");
  });

  test("--json without --confirm prints one object with the summary and moved false, kinds of secrets and never text", async () => {
    const { run } = await move(["--json"]);
    expect(run.code).toBe(1);
    expect(printed(run.out)).toEqual({
      moved: false,
      id: "pkg-1",
      sessionId: "s1",
      claudeSessionId: "claude-1",
      target: "server",
      summary: SUMMARY,
    });
  });

  test("a session that is not idle is refused by the source, and the target is never asked", async () => {
    const busy = {
      ...SOURCE,
      "teleport.prepare": () => ({
        error: { code: "invalid_state", message: "teleport busy", reason: "teleport_busy" },
      }),
    };
    const { run, src, dst } = await move(["--confirm"], busy);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("not idle");
    expect(types(dst)).toEqual([]);
    expect(types(src)).not.toContain("teleport.read");
  });

  test("a manifest that does not hold together is refused and its package is dropped", async () => {
    const bad = { ...SOURCE, "teleport.prepare": () => ({ id: "pkg-1", parts: "nope" }) };
    const { run, src, dst } = await move(["--confirm"], bad);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("does not hold together");
    expect(asked(src).slice(-1)).toEqual([["teleport.cancel", { id: "pkg-1" }]]);
    expect(types(dst)).toEqual([]);
  });

  test("a source that stops before the end of a part leaves nothing on either host", async () => {
    const stuck = {
      ...SOURCE,
      "teleport.read": () => ({ data: b64("x"), next: 0, eof: false }),
    };
    const { run, src, dst } = await move(["--confirm"], stuck);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("stopped before the end");
    expect(asked(dst).slice(-1)).toEqual([["teleport.abort", { id: "recv-1" }]]);
    expect(asked(src).slice(-1)).toEqual([["teleport.cancel", { id: "pkg-1" }]]);
    expect(types(dst)).not.toContain("teleport.finish");
  });

  test("a target that refuses the import is named, cleans both hosts, keeps the source copy, and shows no token or control text", async () => {
    const refusing = {
      ...TARGET,
      "teleport.finish": () => ({
        error: {
          code: "bad_request",
          message: `\u001b[2Jno repo at /srv/api (${TARGET_TOKEN})`,
        },
      }),
    };
    const { run, src, dst, text } = await move(["--confirm"], SOURCE, refusing);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("server: ");
    expect(run.err.join("\n")).toContain("no repo at /srv/api");
    expect(text).not.toContain(TARGET_TOKEN);
    expect(text).not.toContain(LOCAL_TOKEN);
    expect(text).not.toContain("\u001b");
    expect(asked(dst).slice(-1)).toEqual([["teleport.abort", { id: "recv-1" }]]);
    expect(types(src)).toContain("teleport.cancel");
    expect(types(src)).not.toContain("session.meta.set");
  });

  test("a target that puts its own token in what it answers never has it printed, plain or --json", async () => {
    const leaky = {
      ...TARGET,
      "teleport.finish": () => ({
        sessionId: "t-s1",
        worktree: `/srv/${TARGET_TOKEN}/wt`,
        branch: `tp/${TARGET_TOKEN}`,
      }),
    };
    for (const extra of [["--confirm"], ["--confirm", "--json"]]) {
      const { run, text } = await move(extra, SOURCE, leaky);
      expect(run.code).toBe(0);
      expect(text).not.toContain(TARGET_TOKEN);
    }
  });

  test("an unknown host name is refused before the source is asked anything", async () => {
    const { run, src } = await move(["--confirm"], SOURCE, TARGET, [
      "session",
      "teleport",
      "api",
      "--to",
      "nowhere",
      "--repo",
      "/srv/api",
    ]);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain('no host is named "nowhere"');
    expect(src.calls).toEqual([]);
  });

  test("a target address that would carry the token in the clear is refused, and nothing is prepared", async () => {
    const src = fakeDaemon(SOURCE);
    const m = machine({ url: "ws://example.com/v1/ws" });
    const run = await flightdeckd([...ARGV, "--confirm"], src.port, undefined, {
      remote: m.deps,
    });
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("plain ws://");
    expect(types(src)).not.toContain("teleport.prepare");
  });

  test("a session that does not exist is refused and nothing is prepared", async () => {
    const { run, src, dst } = await move(["--confirm"], SOURCE, TARGET, [
      "session",
      "teleport",
      "nobody",
      "--to",
      "server",
      "--repo",
      "/srv/api",
    ]);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("no such session: nobody");
    expect(types(src)).not.toContain("teleport.prepare");
    expect(types(dst)).toEqual([]);
  });

  test("a target daemon that is not there is exit 2, and the source is never asked to package", async () => {
    const src = fakeDaemon(SOURCE);
    const m = machine({ url: "ws://127.0.0.1:9/v1/ws" });
    const run = await flightdeckd([...ARGV, "--confirm"], src.port, undefined, {
      remote: m.deps,
    });
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("could not reach server");
    expect(types(src)).not.toContain("teleport.prepare");
  });

  test("a source daemon that is not there is exit 2", async () => {
    const dst = fakeDaemon(TARGET, TARGET_TOKEN);
    const m = machine({ url: `ws://127.0.0.1:${dst.port}/v1/ws` });
    const run = await flightdeckd([...ARGV, "--confirm"], 9, undefined, { remote: m.deps });
    expect(run.code).toBe(2);
    expect(types(dst)).toEqual([]);
  });
});

/** The runner with the hosts and the stop of the test, as `commands.ts` wires them. */
function direct(
  src: ReturnType<typeof fakeDaemon>,
  dst: ReturnType<typeof fakeDaemon>,
  options: { signal?: AbortSignal; stepMs?: number; confirm?: boolean } = {},
) {
  return runTeleportCli(
    { session: "api", repo: "/srv/api", confirm: options.confirm ?? true },
    config(src.port),
    {
      target: {
        name: "server",
        url: `ws://127.0.0.1:${dst.port}/v1/ws`,
        token: () => TARGET_TOKEN,
      },
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.stepMs ? { stepMs: options.stepMs } : {}),
      cleanupMs: 1000,
    },
  );
}

describe("flightdeckd session teleport, stopped half way (issue #3704)", () => {
  test("Ctrl-C during the transfer says cancelled, exit 1, and frees both hosts without importing", async () => {
    const stop = new AbortController();
    const src = fakeDaemon({
      ...SOURCE,
      "teleport.read": (p) => {
        stop.abort();
        return CHUNKS[p.part as string]?.[p.offset as number];
      },
    });
    const dst = fakeDaemon(TARGET, TARGET_TOKEN);
    const result = await direct(src, dst, { signal: stop.signal });
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("cancelled");
    expect(types(dst)).toContain("teleport.abort");
    expect(types(dst)).not.toContain("teleport.finish");
    expect(types(src)).toContain("teleport.cancel");
    expect(types(src)).not.toContain("session.meta.set");
  });

  test("a target that does not answer the import says the session may or may not be there, exit 1, and archives nothing", async () => {
    const dst = fakeDaemon({ ...TARGET, "teleport.finish": () => undefined }, TARGET_TOKEN);
    const src = fakeDaemon(SOURCE);
    const result = await direct(src, dst, { stepMs: 300 });
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("may or may not");
    expect(result.err.join("\n")).toContain("server");
    expect(types(src)).not.toContain("session.meta.set");
  });

  test("an import that takes longer than one step still lands: it has five steps, not one", async () => {
    const slow = {
      ...TARGET,
      "teleport.finish": async () => {
        // The import is ready 600 ms in, twice the step: the limit it has is the question.
        const ready = Promise.withResolvers<void>();
        setTimeout(ready.resolve, 600);
        await ready.promise;
        return { sessionId: "t-s1", worktree: "/srv/api-wt", branch: "tp/x" };
      },
    };
    const dst = fakeDaemon(slow, TARGET_TOKEN);
    const src = fakeDaemon(SOURCE);
    const result = await direct(src, dst, { stepMs: 300 });
    expect(result.code).toBe(0);
    expect(types(src)).toContain("session.meta.set");
  });

  test("Ctrl-C while the target is still connecting says cancelled at once and asks the source nothing", async () => {
    const stop = new AbortController();
    const dst = fakeDaemon(TARGET, TARGET_TOKEN, { helloDelayMs: 3000 });
    const src = fakeDaemon(SOURCE);
    setTimeout(() => stop.abort(), 100);
    const started = performance.now();
    const result = await direct(src, dst, { signal: stop.signal });
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("cancelled");
    expect(performance.now() - started).toBeLessThan(2000);
    expect(types(src)).not.toContain("teleport.prepare");
  });

  test("Ctrl-C while the source lists its sessions says cancelled, and nothing is prepared", async () => {
    const stop = new AbortController();
    const src = fakeDaemon({
      ...SOURCE,
      // A list that never answers: Ctrl-C is the only way out before the step's 60 s.
      "session.list": () => {
        stop.abort();
        return undefined;
      },
    });
    const dst = fakeDaemon(TARGET, TARGET_TOKEN);
    const started = performance.now();
    const result = await direct(src, dst, { signal: stop.signal });
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("cancelled");
    expect(performance.now() - started).toBeLessThan(5000);
    expect(types(src)).not.toContain("teleport.prepare");
  });

  test("a source that does not answer a step names the call and the step's own seconds, exit 2", async () => {
    const src = fakeDaemon({ ...SOURCE, "teleport.prepare": () => undefined });
    const dst = fakeDaemon(TARGET, TARGET_TOKEN);
    const result = await direct(src, dst, { stepMs: 300 });
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain("teleport.prepare");
    expect(result.err.join("\n")).toContain("in 1 s");
  });
});
