import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { PermissionMode } from "@flightdeck/protocol";
import { CheckLoopSwitch, checkLoopRefusal } from "../src/board/check-loop.ts";
import { startServer } from "../src/server.ts";
import { PrWatcher } from "../src/watch/watch.ts";
import { newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(30_000);

/**
 * Issue #1361 (slice 1c-1): a card's switch for "keep going until the checks pass". It turns on
 * only with checks to run, in a trusted project, outside `plan`; outside `bypassPermissions` only
 * with the person's confirmation, over a near connection. Turning it off always works
 * (docs/decisions/2026-11-09-check-loop.md).
 */
describe("check-loop: when the switch may turn on", () => {
  test("checks, trust, the mode and a confirmation decide, in that order", () => {
    const refusal = (over: {
      checks?: string[];
      trusted?: boolean;
      mode?: PermissionMode;
      confirm?: boolean;
    }) =>
      checkLoopRefusal({
        checks: over.checks ?? ["bun test"],
        trusted: over.trusted ?? true,
        mode: over.mode ?? "bypassPermissions",
        confirm: over.confirm ?? false,
      });
    expect([
      refusal({}),
      refusal({ mode: "default", confirm: true }),
      refusal({ mode: "acceptEdits", confirm: true }),
      refusal({ checks: [] }),
      refusal({ trusted: false }),
      refusal({ mode: "plan", confirm: true }),
      refusal({ mode: "default" }),
      refusal({ mode: "acceptEdits" }),
      refusal({ checks: [], trusted: false, mode: "default" }),
    ]).toEqual([
      null,
      null,
      null,
      "check_loop_no_checks",
      "check_loop_untrusted",
      "check_loop_mode",
      "check_loop_confirm",
      "check_loop_confirm",
      "check_loop_no_checks",
    ]);
  });
});

/** The switch's own fields; how the loop goes (active, round, last) is another test's. */
type SwitchFields = { on: boolean; rounds: number | null; confirmed: boolean };
const switchOf = (value: SwitchFields | undefined) =>
  value
    ? { on: value.on, rounds: value.rounds, confirmed: value.confirmed }
    : "no switch on the card";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup(over: { mode?: PermissionMode; trusted?: boolean; checks?: string[] } = {}) {
  const { board, manager, store, root, repo } = newBoard();
  const project = await board.addProject({ path: repo });
  const card = board.createCard(project.id, { title: "Loop", description: "d" });
  const watcher = new PrWatcher({ db: store.db, board });
  watcher.setSettings(project.id, { checks: over.checks ?? ["bun test"] });
  const checkLoop = new CheckLoopSwitch({
    board,
    settings: (projectId) => watcher.settings(projectId),
    isTrusted: () => over.trusted ?? true,
    modeOf: () => over.mode ?? "default",
  });
  const token = "check-loop-switch-token-0123456789ab";
  const base = {
    manager,
    board,
    checkLoop,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token,
    allowedRoots: [root],
    allowedNetworks: ["0.0.0.0/0", "::/0"],
  };
  const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
  const [near, far] = servers.map((server) => new FrameClient(server.url)) as [
    FrameClient,
    FrameClient,
  ];
  cleanups.push(async () => {
    near.close();
    far.close();
    for (const server of servers) await server.stop();
  });
  for (const client of [near, far]) await client.request("hello", { token, client: "t" });
  /** The card's switch after the request, or the refusal's reason. */
  const set = async (client: FrameClient, request: Record<string, unknown>) => {
    const ack = await client.request("card.checkLoop", { cardId: card.id, ...request });
    const error = ack.error as { reason?: string; code?: string } | undefined;
    return ack.ok === true
      ? switchOf((ack.data as { checkLoop?: SwitchFields }).checkLoop)
      : (error?.reason ?? error?.code ?? "refused");
  };
  return { near, far, set, board, cardId: card.id, store };
}

describe("check-loop: the card's switch over the protocol", () => {
  test("outside bypassPermissions it needs a confirmation, and the confirmation needs a near connection", async () => {
    const { near, far, set } = await setup({ mode: "default" });
    const unconfirmed = await set(near, { on: true });
    const farConfirmed = await set(far, { on: true, confirm: true });
    const nearConfirmed = await set(near, { on: true, confirm: true, rounds: 2 });
    expect([unconfirmed, farConfirmed, nearConfirmed]).toEqual([
      "check_loop_confirm",
      "transport_refused",
      { on: true, rounds: 2, confirmed: true },
    ]);
  });

  test("in bypassPermissions it turns on with no confirmation, but only over a near connection; off always works and clears one", async () => {
    const bypass = await setup({ mode: "bypassPermissions" });
    const farOn = await bypass.set(bypass.far, { on: true });
    const nearOn = await bypass.set(bypass.near, { on: true });
    const confirmed = await setup({ mode: "default" });
    await confirmed.set(confirmed.near, { on: true, confirm: true });
    const off = await confirmed.set(confirmed.far, { on: false });
    expect([farOn, nearOn, off]).toEqual([
      "transport_refused",
      { on: true, rounds: null, confirmed: false },
      { on: false, rounds: null, confirmed: false },
    ]);
  });

  test("with no checks, in an untrusted project or in plan it stays off, with the reason", async () => {
    const none = await setup({ mode: "bypassPermissions", checks: [] });
    const untrusted = await setup({ mode: "bypassPermissions", trusted: false });
    const plan = await setup({ mode: "plan" });
    expect([
      await none.set(none.near, { on: true }),
      await untrusted.set(untrusted.near, { on: true }),
      await plan.set(plan.near, { on: true, confirm: true }),
      switchOf((await none.board.getCard(none.cardId)).checkLoop),
    ]).toEqual([
      "check_loop_no_checks",
      "check_loop_untrusted",
      "check_loop_mode",
      { on: false, rounds: null, confirmed: false },
    ]);
  });

  test("the confirmation is stored with what it confirmed: the checks, checkEnv and the mode", async () => {
    const { near, set, store, cardId } = await setup({ mode: "acceptEdits" });
    await set(near, { on: true, confirm: true });
    const stored = () => {
      try {
        return store.db
          .query<{ at: string | null; hash: string | null }, [string]>(
            "SELECT check_loop_confirmed_at AS at, check_loop_confirmed_hash AS hash FROM cards WHERE id = ?",
          )
          .get(cardId);
      } catch {
        return null;
      }
    };
    const row = stored();
    expect([typeof row?.at, row?.hash?.length]).toEqual(["string", 64]);
  });
});

describe("check-loop: the mode a card's switch is decided on", () => {
  test("a card with no session takes the host's default mode; a session, the mode it runs in now", async () => {
    const { manager, board, repo } = newBoard();
    const project = await board.addProject({ path: repo });
    const ask = (sessionId: string | null) => {
      try {
        return (manager as unknown as { modeOf(id: string | null): string }).modeOf(sessionId);
      } catch {
        return "no answer";
      }
    };
    const { sessionId } = await manager.create(
      { cwd: project.path, prompt: "p", permissionMode: "acceptEdits" },
      {},
    );
    expect([ask(null), ask(sessionId)]).toEqual(["default", "acceptEdits"]);
  });
});

describe("check-loop: the card's mode when its session is over", () => {
  test("an ended or missing session gives the mode the next run starts in, not the one it ended in", async () => {
    const { cardMode } = await import("../src/board/check-loop.ts");
    const modes: Record<string, string> = { live: "bypassPermissions", over: "bypassPermissions" };
    const manager = {
      modeOf: (id: string | null) => {
        if (id === null) return "default" as const;
        if (!(id in modes)) throw new Error("session_not_found");
        return modes[id] as "bypassPermissions";
      },
    };
    const card = (sessionId: string | null, sessionStatus: string | null, variantMode?: string) =>
      ({
        sessionId,
        sessionStatus,
        variant: variantMode ? { permissionMode: variantMode } : null,
      }) as never;
    expect([
      cardMode(card("live", "idle"), manager),
      cardMode(card("over", "ended"), manager),
      cardMode(card("over", "error", "acceptEdits"), manager),
      cardMode(card("gone", "idle"), manager),
      cardMode(card(null, null), manager),
    ]).toEqual(["bypassPermissions", "default", "acceptEdits", "default", "default"]);
  });
});
