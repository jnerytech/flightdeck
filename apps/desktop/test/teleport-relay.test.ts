import { describe, expect, test } from "bun:test";
import type { TeleportManifest } from "@flightdeck/protocol";
import { RequestError } from "../src/lib/host-connection.ts";
import {
  plainText,
  type TeleportRequest,
  type TeleportSummary,
  teleportSession,
  teleportSummary,
} from "../src/lib/teleport.ts";
import { settleMaybe, stays } from "./wait.ts";

/**
 * Issue #100, slice 3a: the app relays a session's package from the source host to the target.
 * The person sees counts and sizes before saying yes, never a secret; the parts travel chunk by
 * chunk; whatever stops the move cleans both hosts.
 */
const TRANSCRIPT =
  '{"type":"user","message":{"content":"token ghp_abcdefghijklmnopqrstuvwxyz0123"}}\n';
const CODE = "a git bundle's bytes";

const MANIFEST: TeleportManifest = {
  id: "pkg-1",
  sessionId: "s1",
  claudeSessionId: "0b6f5c2e-6f0a-4c39-9a51-7c4f1d2e3a4b",
  cwd: "/work/app",
  model: null,
  permissionMode: "default",
  persona: null,
  expiresAt: "2026-11-06T12:30:00.000Z",
  parts: [
    { name: "transcript", size: Buffer.byteLength(TRANSCRIPT), sha256: "a".repeat(64) },
    { name: "code", size: Buffer.byteLength(CODE), sha256: "b".repeat(64) },
  ],
  secrets: { lines: 2, labels: ["github_token", "password_line"] },
  git: {
    branch: "feature",
    head: "c".repeat(40),
    base: "origin/main",
    baseSha: "d".repeat(40),
    ref: "refs/flightdeck/teleport/pkg-1",
    ahead: 3,
    changed: 2,
  },
};

const PARTS: Record<string, string> = { transcript: TRANSCRIPT, code: CODE };

/** Two fake hosts: the source serves its package in 16-byte chunks, the target keeps what lands. */
function hosts(options: { finish?: Error; abortFails?: boolean; cancelFails?: boolean } = {}) {
  const calls: string[] = [];
  const landed: Record<string, string> = {};
  const source = (async (type: string, payload: Record<string, unknown>) => {
    calls.push(`source:${type}`);
    if (type === "teleport.prepare") return MANIFEST;
    if (type === "teleport.read") {
      const bytes = Buffer.from(PARTS[payload.part as string] ?? "");
      const offset = payload.offset as number;
      const next = Math.min(offset + 16, bytes.byteLength);
      return {
        data: bytes.subarray(offset, next).toString("base64"),
        next,
        eof: next >= bytes.byteLength,
      };
    }
    if (type === "teleport.cancel" && options.cancelFails) throw new Error("source went");
    return undefined;
  }) as TeleportRequest;
  const target = (async (type: string, payload: Record<string, unknown>) => {
    calls.push(`target:${type}`);
    if (type === "teleport.receive") return { id: "in-1" };
    if (type === "teleport.write") {
      const part = payload.part as string;
      landed[part] =
        (landed[part] ?? "") + Buffer.from(payload.data as string, "base64").toString();
      return { written: landed[part]?.length ?? 0 };
    }
    if (type === "teleport.finish") {
      if (options.finish) throw options.finish;
      return {
        sessionId: "t1",
        worktree: "/work/app/.flightdeck/worktrees/teleport-feature",
        branch: "fd/teleport-feature",
      };
    }
    if (type === "teleport.abort" && options.abortFails) throw new Error("target went");
    return undefined;
  }) as TeleportRequest;
  return { source, target, calls, landed };
}

const run = (
  h: ReturnType<typeof hosts>,
  over: Partial<Parameters<typeof teleportSession>[0]> = {},
) =>
  teleportSession({
    source: h.source,
    target: h.target,
    sessionId: "s1",
    repo: "/work/app",
    confirm: async () => true,
    ...over,
  });

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => "no failure",
    (error: { reason?: string; message?: string }) =>
      error.reason ?? error.message ?? String(error),
  );

describe("teleport-relay: the app moves a session from one host to another (#100)", () => {
  test("the person sees counts and sizes, never a secret or its kind", () => {
    const summary = teleportSummary(MANIFEST);
    expect([
      summary,
      JSON.stringify(summary).includes("token"),
      JSON.stringify(summary).includes("senha"),
    ]).toEqual([
      {
        branch: "feature",
        ahead: 3,
        changed: 2,
        bytes: Buffer.byteLength(TRANSCRIPT) + Buffer.byteLength(CODE),
        secretLines: 2,
      },
      false,
      false,
    ]);
  });

  test("a yes relays every part whole, the target imports it, and the source's package goes", async () => {
    const h = hosts();
    const seen: TeleportSummary[] = [];
    const progress: number[] = [];
    const outcome = await run(h, {
      confirm: async (summary) => {
        seen.push(summary);
        return true;
      },
      onProgress: (sent, total) => progress.push(total - sent),
    });
    expect([
      outcome,
      h.landed,
      seen.length,
      progress.at(-1),
      h.calls[0],
      h.calls.filter((c) => c === "target:teleport.write").length,
      h.calls.slice(-2),
    ]).toEqual([
      {
        kind: "moved",
        sessionId: "t1",
        worktree: "/work/app/.flightdeck/worktrees/teleport-feature",
        branch: "fd/teleport-feature",
      },
      PARTS,
      1,
      0,
      "source:teleport.prepare",
      Math.ceil(Buffer.byteLength(TRANSCRIPT) / 16) + Math.ceil(Buffer.byteLength(CODE) / 16),
      ["target:teleport.finish", "source:teleport.cancel"],
    ]);
  });

  test("a no touches the target, and the source's package goes", async () => {
    const h = hosts();
    const outcome = await run(h, { confirm: async () => false });
    expect([outcome, h.calls]).toEqual([
      { kind: "declined" },
      ["source:teleport.prepare", "source:teleport.cancel"],
    ]);
  });

  test("a refusal on the target is passed on, and both hosts drop what they hold", async () => {
    const h = hosts({ finish: new RequestError("invalid_state", "x", "teleport_no_project") });
    const why = await failure(run(h));
    expect([why, h.calls.slice(-2)]).toEqual([
      "teleport_no_project",
      ["target:teleport.abort", "source:teleport.cancel"],
    ]);
  });

  test("a cancel during the transfer stops it, and both hosts drop what they hold", async () => {
    const h = hosts();
    const stop = new AbortController();
    const outcome = await run(h, {
      onProgress: (sent) => {
        if (sent >= 16) stop.abort();
      },
      signal: stop.signal,
    });
    expect([outcome, h.calls.includes("target:teleport.finish"), h.calls.slice(-2)]).toEqual([
      { kind: "cancelled" },
      false,
      ["target:teleport.abort", "source:teleport.cancel"],
    ]);
  });

  test("a move cancelled before it starts never reaches the target", async () => {
    const h = hosts();
    const stop = new AbortController();
    const outcome = await run(h, {
      confirm: async () => {
        stop.abort();
        return true;
      },
      signal: stop.signal,
    });
    expect([outcome, h.calls]).toEqual([
      { kind: "cancelled" },
      ["source:teleport.prepare", "source:teleport.cancel"],
    ]);
  });

  test("a source whose chunks do not move on ends the transfer instead of spinning", async () => {
    const h = hosts();
    let reads = 0;
    const stuck = (async (type: string, payload: never) => {
      if (type === "teleport.read") {
        reads++;
        // Ends on the third try, so a relay that spins shows as a count, not a hang.
        return { data: "", next: 0, eof: reads >= 3 };
      }
      return h.source(type as "teleport.prepare", payload);
    }) as TeleportRequest;
    const why = await failure(run(h, { source: stuck }));
    expect([why, reads]).toEqual(["teleport_incomplete", 1]);
  });

  test("a source that sends past a part's size, ends a part early or sends a manifest that is not one is refused", async () => {
    const reader = (chunk: (offset: number) => { data: string; next: number; eof: boolean }) => {
      const h = hosts();
      return (async (type: string, payload: { offset?: number }) =>
        type === "teleport.read"
          ? chunk(payload.offset ?? 0)
          : h.source(type as "teleport.prepare", payload as never)) as TeleportRequest;
    };
    const past = reader(() => ({ data: "eA==", next: 10_000, eof: true }));
    const early = reader(() => ({ data: "eA==", next: 1, eof: true }));
    const bad = (async () => ({
      ...MANIFEST,
      parts: [{ name: "transcript", size: -1, sha256: "a" }],
    })) as TeleportRequest;
    expect([
      await failure(run(hosts(), { source: past })),
      await failure(run(hosts(), { source: early })),
      await failure(run(hosts(), { source: bad })),
    ]).toEqual(["teleport_corrupt", "teleport_incomplete", "teleport_corrupt"]);
  });

  test("a host that never answers the clean-up does not hold the move, and the other host is still cleaned", async () => {
    const h = hosts({ finish: new RequestError("invalid_state", "x", "teleport_exists") });
    // An abort that never answers: a move that waits for it never returns.
    const slow = (async (type: string, payload: never) =>
      type === "teleport.abort"
        ? new Promise(() => {})
        : h.target(type as "teleport.receive", payload)) as TeleportRequest;
    const why = await failure(run(h, { target: slow, cleanupMs: 50 }));
    // The move returns at all only because the clean-up has a limit: the abort never answers.
    expect([why, h.calls.at(-1)]).toEqual(["teleport_exists", "source:teleport.cancel"]);
  });

  test("a branch name shows as plain text: no control or direction marks", () => {
    const summary = teleportSummary({
      ...MANIFEST,
      git: {
        ...(MANIFEST.git as NonNullable<TeleportManifest["git"]>),
        branch: "fix\u202e\u0007-login",
      },
    });
    const marksOnly = teleportSummary({
      ...MANIFEST,
      git: { ...(MANIFEST.git as NonNullable<TeleportManifest["git"]>), branch: "\u202e\u200b" },
    });
    expect([summary.branch, marksOnly.branch]).toEqual(["fix-login", null]);
  });

  test("line and paragraph separators and look-alike spaces show as one plain space (#100)", () => {
    expect([
      plainText("fix\u2028login\u2029now", 64),
      plainText("a\u00a0b\u2003c\u3000d\u202fe\u2009f", 64),
      plainText("a\u00a0\u00a0 b", 64),
      plainText("\u2028\u00a0 ", 64),
      plainText("two  spaces", 64),
    ]).toEqual(["fix login now", "a b c d e f", "a b", "", "two spaces"]);
  });

  test("a source that answers prepare with something that is not a manifest is refused, and never told an id it made up", async () => {
    const h = hosts();
    const garbage = (async (type: string, payload: never) =>
      type === "teleport.prepare"
        ? null
        : h.source(type as "teleport.cancel", payload)) as TeleportRequest;
    const why = await failure(run(h, { source: garbage }));
    expect([why, h.calls]).toEqual(["teleport_corrupt", []]);
  });

  test("a host that went while cleaning up does not hide why the move stopped", async () => {
    const h = hosts({
      finish: new RequestError("invalid_state", "x", "teleport_exists"),
      abortFails: true,
      cancelFails: true,
    });
    expect(await failure(run(h))).toBe("teleport_exists");
  });

  test("a cancel while a host does not answer a chunk ends the move, and both hosts are told", async () => {
    const h = hosts();
    let waiting = false;
    // A read that never answers: a move that waits for it cannot be cancelled.
    const hung = (async (type: string, payload: never) => {
      if (type === "teleport.read") {
        waiting = true;
        return new Promise(() => {});
      }
      return h.source(type as "teleport.prepare", payload);
    }) as TeleportRequest;
    const stop = new AbortController();
    let outcome: unknown = "still waiting";
    void run(h, { source: hung, signal: stop.signal }).then((done) => {
      outcome = done;
    });
    await settleMaybe(() => waiting);
    stop.abort();
    await settleMaybe(() => outcome !== "still waiting", 2000);
    expect([outcome, h.calls.slice(-2)]).toEqual([
      { kind: "cancelled" },
      ["target:teleport.abort", "source:teleport.cancel"],
    ]);
  });

  test("a cancel after the last chunk, before the import, never reaches the target's import", async () => {
    const h = hosts();
    const stop = new AbortController();
    const outcome = await run(h, {
      onProgress: (sent, total) => {
        if (sent === total) stop.abort();
      },
      signal: stop.signal,
    });
    expect([outcome, h.calls.includes("target:teleport.finish"), h.calls.slice(-2)]).toEqual([
      { kind: "cancelled" },
      false,
      ["target:teleport.abort", "source:teleport.cancel"],
    ]);
  });

  test("a manifest that is not one still frees the source's package when its id is one", async () => {
    const cancelled = async (manifest: unknown) => {
      const ids: unknown[] = [];
      const source = (async (type: string, payload: { id?: unknown }) => {
        if (type === "teleport.prepare") return manifest;
        if (type === "teleport.cancel") ids.push(payload.id);
        return undefined;
      }) as TeleportRequest;
      const why = await failure(run(hosts(), { source }));
      return [why, ids];
    };
    const broken = { ...MANIFEST, parts: [{ name: "transcript", size: -1, sha256: "a" }] };
    expect([
      await cancelled(broken),
      await cancelled({ ...broken, id: "" }),
      await cancelled({ ...broken, id: { not: "an id" } }),
      await cancelled(null),
    ]).toEqual([
      ["teleport_corrupt", ["pkg-1"]],
      ["teleport_corrupt", []],
      ["teleport_corrupt", []],
      ["teleport_corrupt", []],
    ]);
  });

  test("a cancel while the source prepares, or the target opens its inbox, ends the move, and what answers late is freed", async () => {
    const late = async (where: "prepare" | "receive") => {
      const h = hosts();
      let answer: ((value: unknown) => void) | null = null;
      const held = (async (type: string, payload: never) => {
        if (type === `teleport.${where}`) {
          return new Promise<unknown>((resolve) => {
            answer = resolve;
          });
        }
        return (where === "prepare" ? h.source : h.target)(type as "teleport.cancel", payload);
      }) as TeleportRequest;
      const stop = new AbortController();
      let outcome: unknown = "still waiting";
      void run(h, {
        ...(where === "prepare" ? { source: held } : { target: held }),
        signal: stop.signal,
      }).then((done) => {
        outcome = done;
      });
      await settleMaybe(() => answer !== null);
      stop.abort();
      await settleMaybe(() => outcome !== "still waiting", 2000);
      const calls = h.calls.length;
      // The host answers after the move ended: its package goes.
      (answer as unknown as (value: unknown) => void)(
        where === "prepare" ? MANIFEST : { id: "in-late" },
      );
      await settleMaybe(() => h.calls.length > calls, 2000);
      return [outcome, h.calls.slice(calls)];
    };
    expect([await late("prepare"), await late("receive")]).toEqual([
      [{ kind: "cancelled" }, ["source:teleport.cancel"]],
      [{ kind: "cancelled" }, ["target:teleport.abort"]],
    ]);
  });

  test("a session on no branch shows none", () => {
    const summary = teleportSummary({
      ...MANIFEST,
      git: { ...(MANIFEST.git as NonNullable<TeleportManifest["git"]>), branch: null },
    });
    expect(summary.branch).toBeNull();
  });

  test("a host that refuses after the move was cancelled is not an error anywhere", async () => {
    const stray: unknown[] = [];
    const onStray = (reason: unknown) => stray.push(reason);
    process.on("unhandledRejection", onStray);
    try {
      const h = hosts();
      let refuse: ((error: unknown) => void) | null = null;
      const held = (async (type: string, payload: never) =>
        type === "teleport.prepare"
          ? new Promise((_resolve, reject) => {
              refuse = reject;
            })
          : h.source(type as "teleport.cancel", payload)) as TeleportRequest;
      const stop = new AbortController();
      let outcome: unknown = "still waiting";
      void run(h, { source: held, signal: stop.signal }).then((done) => {
        outcome = done;
      });
      await settleMaybe(() => refuse !== null);
      stop.abort();
      await settleMaybe(() => outcome !== "still waiting", 2000);
      (refuse as unknown as (error: unknown) => void)(
        new RequestError("invalid_state", "x", "teleport_busy"),
      );
      const quiet = await stays(() => stray.length === 0, 200).then(
        () => true,
        () => false,
      );
      expect([outcome, quiet, h.calls]).toEqual([{ kind: "cancelled" }, true, []]);
    } finally {
      process.off("unhandledRejection", onStray);
    }
  });
});
