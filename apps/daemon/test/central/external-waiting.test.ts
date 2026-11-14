import { describe, expect, test } from "bun:test";
import { appendFileSync, closeSync, openSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExternalSession, WAITING_PLAN_MAX } from "@flightdeck/protocol";
import { ExternalSessions, type ExternalSession as Session } from "../../src/central/external.ts";
import { planTextIn, type Tail, tailOfFile, waitingIn } from "../../src/central/waiting.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { tempDir } from "../support/helpers.ts";

const T0 = Date.parse("2026-11-10T12:00:00.000Z");

const entry = (type: "assistant" | "user", content: unknown[], extra: object = {}) =>
  `${JSON.stringify({ type, message: { role: type, content }, ...extra })}\n`;
const text = (value: string) => ({ type: "text", text: value });
const call = (name: string, input: object = {}) => ({
  type: "tool_use",
  id: `toolu_${name}`,
  name,
  input,
});
const result = (name: string) => ({
  type: "tool_result",
  tool_use_id: `toolu_${name}`,
  content: "ok",
});

describe("external-waiting: what a transcript's end waits for (#1736)", () => {
  test("a plan approval or a question with nothing after it is what the session waits for", () => {
    expect(
      waitingIn(entry("assistant", [text("plano")]) + entry("assistant", [call("ExitPlanMode")])),
    ).toBe("plan");
    expect(waitingIn(entry("assistant", [call("AskUserQuestion")]))).toBe("question");
  });

  test("an answer after it, another tool, or plain text is not a wait", () => {
    const plan = entry("assistant", [call("ExitPlanMode")]);
    expect(waitingIn(plan + entry("user", [result("ExitPlanMode")]))).toBeNull();
    expect(waitingIn(entry("assistant", [call("Bash")]))).toBeNull();
    expect(waitingIn(entry("assistant", [text("pronto")]))).toBeNull();
    expect(waitingIn("")).toBeNull();
  });

  test("lines that are not entries, and a subagent's, are skipped; a line cut in two is ignored", () => {
    const plan = entry("assistant", [call("ExitPlanMode")]);
    const noise = `${JSON.stringify({ type: "system", content: "x" })}\nnot json\n`;
    expect(waitingIn(`ial","x":1}\n${plan}${noise}`)).toBe("plan");
    const sidechain = entry("assistant", [text("sub")], { isSidechain: true });
    expect(waitingIn(plan + sidechain)).toBe("plan");
  });

  test("the protocol carries it on the external session", () => {
    const base = {
      claudeSessionId: "s1",
      cwd: null,
      transcriptPath: null,
      source: null,
      status: "idle",
      statusReason: null,
      launchId: null,
      controllable: false,
      projectKey: null,
      startedAt: "2026-11-10T12:00:00Z",
      lastEventAt: "2026-11-10T12:00:00Z",
      endedAt: null,
    };
    expect(ExternalSession.parse({ ...base, waiting: "plan" }).waiting).toBe("plan");
    expect(ExternalSession.parse({ ...base, waiting: null }).waiting).toBeNull();
    expect(ExternalSession.parse(base).waiting).toBeUndefined();
  });

  test("a tool named like an inherited object member is no wait", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(waitingIn(entry("assistant", [call(name)]))).toBeNull();
    }
  });
});

describe.skipIf(process.platform === "win32")(
  "external-waiting: a transcript path that is not a regular file is never opened (#1736)",
  () => {
    // A named pipe blocks `open` until a writer shows up; a hook's path must not stall the sweep.
    const pipe = () => {
      const path = join(tempDir(), "pipe.jsonl");
      Bun.spawnSync(["mkfifo", path]);
      return path;
    };
    const hung = Symbol("hung");
    // A deadline for work that must not hang, not a wait for something to happen.
    const within = <T>(work: Promise<T>, ms = 1500) =>
      Promise.race([
        work,
        new Promise<typeof hung>((done) =>
          AbortSignal.timeout(ms).addEventListener("abort", () => done(hung)),
        ),
      ]);
    // Opening the pipe for writing frees a reader that is stuck, so the test leaves nothing behind.
    const release = (path: string) => closeSync(openSync(path, "r+"));

    test("reading the tail of a pipe gives nothing and does not wait for a writer", async () => {
      const path = pipe();
      const got = await within(tailOfFile(path));
      release(path);
      expect(got).toBeNull();
    });

    test("a sweep goes past a session whose transcript is a pipe and still reads the next one", async () => {
      const store = new EventStore(":memory:");
      const registry = new ExternalSessions({ db: store.db, staleAfterS: 900, now: () => T0 });
      const path = pipe();
      const real = join(tempDir(), "real.jsonl");
      writeFileSync(real, entry("assistant", [call("ExitPlanMode")]));
      registry.apply("SessionStart", { session_id: "p1", transcript_path: path });
      registry.apply("SessionStart", { session_id: "p2", transcript_path: real });
      const swept = await within(registry.sweep());
      release(path);
      expect(swept).not.toBe(hung);
      expect(registry.get("p2")?.waiting).toBe("plan");
      expect(registry.get("p1")?.waiting ?? null).toBeNull();
    });
  },
);

function setup() {
  const store = new EventStore(":memory:");
  const dir = tempDir();
  const transcript = join(dir, "s1.jsonl");
  writeFileSync(transcript, entry("user", [text("oi")]));
  const reads: string[] = [];
  const realTail = async (path: string): Promise<Tail | null> => {
    reads.push(path);
    const { readFileSync, statSync } = await import("node:fs");
    const info = statSync(path);
    return { text: readFileSync(path, "utf8"), size: info.size, mtimeMs: info.mtimeMs };
  };
  const registry = new ExternalSessions({
    db: store.db,
    staleAfterS: 900,
    now: () => T0,
    readTail: realTail,
  });
  const updates: Session[] = [];
  registry.onChange((session) => updates.push(session));
  const hook = (event: string) =>
    registry.apply(event, { session_id: "s1", cwd: dir, transcript_path: transcript });
  return { registry, transcript, updates, reads, hook };
}

describe("external-waiting: the sessions started in a terminal say what they wait for (#1736)", () => {
  test("a sweep reads the transcript's end and says plan; the next event clears it", async () => {
    const { registry, transcript, updates, hook } = setup();
    hook("SessionStart");
    appendFileSync(transcript, entry("assistant", [call("ExitPlanMode")]));
    await registry.sweep();
    expect(registry.get("s1")?.waiting).toBe("plan");
    expect(registry.list()[0]?.waiting).toBe("plan");
    expect(updates.at(-1)?.waiting).toBe("plan");
    hook("UserPromptSubmit");
    expect(registry.get("s1")?.waiting ?? null).toBeNull();
  });

  test("a file that did not change is not read again; one that did is", async () => {
    const { registry, transcript, reads, hook } = setup();
    hook("SessionStart");
    appendFileSync(transcript, entry("assistant", [call("AskUserQuestion")]));
    await registry.sweep();
    await registry.sweep();
    expect(reads).toHaveLength(1);
    appendFileSync(transcript, entry("user", [result("AskUserQuestion")]));
    const later = new Date(T0 + 60_000);
    utimesSync(transcript, later, later);
    await registry.sweep();
    expect(reads).toHaveLength(2);
    expect(registry.get("s1")?.waiting ?? null).toBeNull();
  });

  test("a notification does not end the wait: the transcript did not move", async () => {
    const { registry, transcript, hook } = setup();
    hook("SessionStart");
    appendFileSync(transcript, entry("assistant", [call("ExitPlanMode")]));
    await registry.sweep();
    registry.apply("Notification", {
      session_id: "s1",
      transcript_path: transcript,
      notification_type: "idle_prompt",
    });
    expect(registry.get("s1")?.waiting).toBe("plan");
  });

  test("a read that failed is tried again at the next sweep, not remembered as waiting for nothing", async () => {
    const store = new EventStore(":memory:");
    const dir = tempDir();
    const transcript = join(dir, "s1.jsonl");
    writeFileSync(transcript, entry("assistant", [call("AskUserQuestion")]));
    let failing = true;
    const registry = new ExternalSessions({
      db: store.db,
      staleAfterS: 900,
      now: () => T0,
      readTail: async (path) => {
        if (failing) return null;
        const { readFileSync, statSync } = await import("node:fs");
        const info = statSync(path);
        return { text: readFileSync(path, "utf8"), size: info.size, mtimeMs: info.mtimeMs };
      },
    });
    registry.apply("SessionStart", { session_id: "s1", transcript_path: transcript });
    await registry.sweep();
    expect(registry.get("s1")?.waiting ?? null).toBeNull();
    failing = false;
    await registry.sweep();
    expect(registry.get("s1")?.waiting).toBe("question");
  });

  test("an ended session, one with no readable transcript, or a read that throws says nothing", async () => {
    const { registry, transcript, hook } = setup();
    hook("SessionStart");
    appendFileSync(transcript, entry("assistant", [call("ExitPlanMode")]));
    hook("SessionEnd");
    await registry.sweep();
    expect(registry.get("s1")?.waiting ?? null).toBeNull();
    const store = new EventStore(":memory:");
    const broken = new ExternalSessions({
      db: store.db,
      staleAfterS: 900,
      now: () => T0,
      readTail: async () => {
        throw new Error("EACCES");
      },
    });
    broken.apply("SessionStart", { session_id: "s2", transcript_path: transcript });
    await broken.sweep();
    expect(broken.get("s2")?.waiting ?? null).toBeNull();
  });
});

describe("external-waiting: the plan a session waits for approval on (#1751)", () => {
  const plan = (text: string) => entry("assistant", [call("ExitPlanMode", { plan: text })]);

  test("the plan text is what the ExitPlanMode call carries, accents and emoji kept", () => {
    expect(planTextIn(plan("1. Ler o código ✅\n2. Escrever o teste"))).toBe(
      "1. Ler o código ✅\n2. Escrever o teste",
    );
  });

  test("no plan text when the wait is a question, the plan is answered, or the call carries none", () => {
    expect(planTextIn(entry("assistant", [call("AskUserQuestion", { plan: "x" })]))).toBeNull();
    expect(planTextIn(plan("x") + entry("user", [result("ExitPlanMode")]))).toBeNull();
    expect(planTextIn(entry("assistant", [call("ExitPlanMode")]))).toBeNull();
    expect(planTextIn(entry("assistant", [call("ExitPlanMode", { plan: 7 })]))).toBeNull();
    expect(planTextIn(entry("assistant", [call("ExitPlanMode", { plan: "" })]))).toBeNull();
    expect(planTextIn("")).toBeNull();
  });

  test("a plan longer than the cap is cut at it and ends with an ellipsis", () => {
    const cut = planTextIn(plan("a".repeat(WAITING_PLAN_MAX + 1)));
    expect([cut?.length, cut?.endsWith("…")]).toEqual([WAITING_PLAN_MAX, true]);
    expect(planTextIn(plan("a".repeat(WAITING_PLAN_MAX)))).toBe("a".repeat(WAITING_PLAN_MAX));
  });

  test("the cap never splits an emoji in two", () => {
    const cut = planTextIn(plan("🚀".repeat(WAITING_PLAN_MAX)));
    expect(cut).toMatch(/^🚀+…$/u);
    expect(cut?.length).toBeLessThanOrEqual(WAITING_PLAN_MAX);
  });

  test("the protocol carries it on the external session, and refuses one past the cap", () => {
    const base = {
      claudeSessionId: "s1",
      cwd: null,
      transcriptPath: null,
      source: null,
      status: "idle",
      statusReason: null,
      launchId: null,
      controllable: false,
      projectKey: null,
      startedAt: "2026-11-10T12:00:00Z",
      lastEventAt: "2026-11-10T12:00:00Z",
      endedAt: null,
      waiting: "plan",
    };
    expect(ExternalSession.parse({ ...base, waitingPlan: "p" }).waitingPlan).toBe("p");
    expect(ExternalSession.parse(base).waitingPlan).toBeUndefined();
    expect(
      ExternalSession.safeParse({ ...base, waitingPlan: "a".repeat(WAITING_PLAN_MAX + 1) }).success,
    ).toBe(false);
  });

  test("a sweep puts the plan on the session; the next event clears it", async () => {
    const { registry, transcript, updates, hook } = setup();
    hook("SessionStart");
    appendFileSync(transcript, plan("Ship it"));
    await registry.sweep();
    expect(registry.get("s1")?.waitingPlan).toBe("Ship it");
    expect(updates.at(-1)?.waitingPlan).toBe("Ship it");
    hook("UserPromptSubmit");
    expect(registry.get("s1")?.waitingPlan).toBeUndefined();
  });

  test("a plan rewritten under the same wait is told to the app again", async () => {
    const { registry, transcript, updates, hook } = setup();
    hook("SessionStart");
    appendFileSync(transcript, plan("first"));
    await registry.sweep();
    appendFileSync(transcript, entry("user", [result("ExitPlanMode")]) + plan("second"));
    const later = new Date(T0 + 60_000);
    utimesSync(transcript, later, later);
    await registry.sweep();
    expect(updates.at(-1)?.waitingPlan).toBe("second");
  });

  test("a question puts no plan on the session", async () => {
    const { registry, transcript, hook } = setup();
    hook("SessionStart");
    appendFileSync(transcript, entry("assistant", [call("AskUserQuestion", { plan: "x" })]));
    await registry.sweep();
    expect([registry.get("s1")?.waiting, registry.get("s1")?.waitingPlan]).toEqual([
      "question",
      undefined,
    ]);
  });
});
