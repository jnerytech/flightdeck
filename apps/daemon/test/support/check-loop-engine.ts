import type { PermissionMode } from "@flightdeck/protocol";
import {
  CheckLoopEngine,
  type LoopCard,
  type RoundRecord,
} from "../../src/board/domain/check-loop-engine.ts";
import type { CheckOutcome } from "../../src/watch/domain/check-run.ts";

/**
 * Issue #1361 (slice 1c-2b): the check loop as a state machine. The board tells it each session
 * event and does what it says in the same step (hold the slot, or let the card move on); the
 * checks run between, and every exit releases the slot exactly once
 * (docs/decisions/2026-11-09-check-loop.md).
 */
export const FAIL: Extract<CheckOutcome, { kind: "failed" }> = {
  kind: "failed",
  command: "bun test",
  exitCode: 1,
  timedOut: false,
  tooLarge: false,
  output: "1 failed",
};
export const PASS: Extract<CheckOutcome, { kind: "passed" }> = { kind: "passed" };

type EngineFx = ConstructorParameters<typeof CheckLoopEngine>[0];

export function rig(
  over: {
    card?: Partial<LoopCard>;
    mode?: PermissionMode;
    trusted?: boolean;
    limit?: "budget" | "quota" | "memory" | null;
    outcomes?: CheckOutcome[];
    /** The project's extra environment names (`checkEnv`). */
    checkEnv?: string[];
    /** The card reads as gone after this many reads (the card discarded under the loop). */
    vanishAfter?: number;
  } = {},
) {
  const settings = {
    checks: ["bun test"],
    checkTimeoutMin: 10,
    checkRounds: 3,
    checkEnv: over.checkEnv ?? ([] as string[]),
  };
  let mode: PermissionMode = over.mode ?? "bypassPermissions";
  let trusted = over.trusted ?? true;
  let limit = over.limit ?? null;
  const card: LoopCard = {
    on: true,
    rounds: null,
    confirmedHash: null,
    plainRun: true,
    worktree: "/w/tree",
    projectId: "p",
    ...over.card,
  };
  const outcomes = [...(over.outcomes ?? [PASS])];
  const log: string[] = [];
  const records: RoundRecord[] = [];
  const sent: string[] = [];
  const signals: AbortSignal[] = [];
  /** What each run of the checks was asked to do, without its signal. */
  const inputs: object[] = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  /** Lets a test hold a check until it says so. */
  let gate: Promise<void> | null = null;
  let reads = 0;
  /** Runs inside `send`: the real manager emits busy and the message's echo during it. */
  let onSend: (() => void) | null = null;
  const fx: EngineFx = {
    card: () => {
      reads += 1;
      // A copy per read, as the store gives one.
      return over.vanishAfter !== undefined && reads > over.vanishAfter ? null : { ...card };
    },
    // A copy per read, as the store gives: a test that edits the settings sees what a new read sees.
    settings: () => ({
      ...settings,
      checks: [...settings.checks],
      checkEnv: [...settings.checkEnv],
    }),
    mode: () => mode,
    trusted: () => trusted,
    limit: () => limit,
    runChecks: async ({ signal, ...asked }) => {
      signals.push(signal);
      inputs.push(asked);
      if (gate) await gate;
      return outcomes.shift() ?? PASS;
    },
    send: (_id, text) => {
      sent.push(text);
      log.push("send");
      onSend?.();
    },
    release: () => log.push("release"),
    place: () => log.push("place"),
    record: (_id, record) => records.push(record),
    timer: {
      set: (fn, ms) => {
        const handle = { fn, ms, cleared: false };
        timers.push(handle);
        return handle;
      },
      clear: (handle) => {
        (handle as { cleared: boolean }).cleared = true;
      },
    },
  };
  const engine = new CheckLoopEngine(fx);
  /** The same collaborators with some replaced: an engine whose check or record throws. */
  const engineWith = (replace: Partial<EngineFx>) => new CheckLoopEngine({ ...fx, ...replace });
  const checksDone = () => engine.idle("c");
  return {
    engine,
    engineWith,
    card,
    settings,
    log,
    records,
    sent,
    signals,
    inputs,
    timers,
    checksDone,
    setMode: (next: PermissionMode) => (mode = next),
    setTrusted: (next: boolean) => (trusted = next),
    setLimit: (next: typeof limit) => (limit = next),
    duringSend: (fn: () => void) => (onSend = fn),
    hold: () => {
      let open = () => {};
      gate = new Promise<void>((done) => (open = done));
      return () => {
        gate = null;
        open();
      };
    },
  };
}

export const ok = { isError: false, interrupted: false };
