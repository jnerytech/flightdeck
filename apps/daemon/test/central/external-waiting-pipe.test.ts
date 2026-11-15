import { describe, expect, test } from "bun:test";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExternalSessions } from "../../src/central/external.ts";
import { tailOfFile } from "../../src/central/waiting.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { tempDir } from "../support/helpers.ts";

const T0 = Date.parse("2026-11-10T12:00:00.000Z");

const entry = (type: "assistant" | "user", content: unknown[], extra: object = {}) =>
  `${JSON.stringify({ type, message: { role: type, content }, ...extra })}\n`;
const call = (name: string, input: object = {}) => ({
  type: "tool_use",
  id: `toolu_${name}`,
  name,
  input,
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
