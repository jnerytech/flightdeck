import { describe, expect, test } from "bun:test";
import type { ExternalSession } from "@flightdeck/protocol";
import { activityBoard, NO_ACTIVITY_FILTER } from "../../src/features/activity/activity.ts";
import { pendingText } from "../../src/features/sessions/pending-text.ts";
import { trayMenu } from "../../src/features/tray/tray.ts";
import { translator } from "../../src/i18n/index.ts";
import { type AppState, AppStore, needsYou } from "../../src/lib/app-store.ts";
import { activityState, NOW } from "../activity/fixtures.ts";
import { memoryPlatform } from "../fixtures.ts";

/**
 * Issue #1751: a terminal session waiting at a plan approval or a question needs the person, so
 * the tray, the badge and the notifications (all fed by `needsYou`) list it, as the sessions list
 * already does (#1736). The person answers it in the terminal: the app can only open it.
 */
const external = (over: Partial<ExternalSession>): ExternalSession => ({
  claudeSessionId: "c1",
  cwd: "/w/app",
  transcriptPath: null,
  source: null,
  status: "idle",
  statusReason: null,
  launchId: null,
  controllable: false,
  projectKey: null,
  startedAt: "2026-11-10T11:00:00Z",
  lastEventAt: "2026-11-10T11:57:00Z",
  endedAt: null,
  ...over,
});

const stateOf = (sessions: ExternalSession[], requests: Record<string, unknown> = {}) =>
  ({
    hosts: [{ id: "h", name: "alfa", sessions: [] }],
    externals: Object.fromEntries(sessions.map((s) => [`h/${s.claudeSessionId}`, s])),
    externalRequests: requests,
    runs: {},
    vaultApprovals: [],
    meta: {},
    cards: {},
    names: {},
    personas: {},
  }) as unknown as AppState;

describe("needs-you-terminal-wait: a terminal session at a plan or a question needs you (#1751)", () => {
  test("a session waiting at a plan approval is listed, as a wait with no request to answer", () => {
    const [item, ...rest] = needsYou(stateOf([external({ waiting: "plan" })]));
    expect(rest).toEqual([]);
    expect([item?.waiting, item?.sessionId, item?.hostId, item?.createdAt]).toEqual([
      "plan",
      "c1",
      "h",
      "2026-11-10T11:57:00Z",
    ]);
  });

  test("a session waiting on a question is listed", () => {
    const items = needsYou(stateOf([external({ waiting: "question" })]));
    expect(items.map((i) => i.waiting)).toEqual(["question"]);
  });

  test("a session waiting for nothing, or one that has ended, is not listed", () => {
    const items = needsYou(
      stateOf([
        external({ claudeSessionId: "a", waiting: null }),
        external({ claudeSessionId: "b" }),
        external({ claudeSessionId: "c", waiting: "plan", status: "ended" }),
      ]),
    );
    expect(items).toEqual([]);
  });

  test("a session whose hook already holds the plan request is listed once, by that request", () => {
    const request = {
      type: "external.permission",
      requestId: "r1",
      claudeSessionId: "c1",
      toolName: "ExitPlanMode",
      input: {},
      state: "open",
      createdAt: "2026-11-10T11:58:00Z",
    };
    const items = needsYou(stateOf([external({ waiting: "plan" })], { "h/r1": request }));
    expect(items.map((i) => i.requestId)).toEqual(["r1"]);
  });

  test("the tray offers only to open a wait: nothing in the app approves it", () => {
    const items = needsYou(stateOf([external({ waiting: "plan" })]));
    expect(trayMenu(items).items.map((i) => i.actions)).toEqual([["open"]]);
  });

  test("the line says what it waits for, in both languages", () => {
    const [plan, question] = needsYou(
      stateOf([
        external({ claudeSessionId: "a", waiting: "plan" }),
        external({
          claudeSessionId: "b",
          waiting: "question",
          lastEventAt: "2026-11-10T11:58:00Z",
        }),
      ]),
    );
    expect([
      plan && pendingText(plan, translator("en")),
      question && pendingText(question, translator("en")),
      plan && pendingText(plan, translator("pt-BR")),
    ]).toEqual([
      "plan waiting for your approval",
      "has a question for you",
      "plano esperando sua aprovação",
    ]);
  });

  test("the Activity card of a waiting terminal session offers no approve or deny", () => {
    const base = new AppStore(memoryPlatform(false, "en").platform, {
      baseDelayMs: 600_000,
    }).getState();
    const state = {
      ...activityState([], base),
      externals: { "h1/c1": external({ waiting: "plan" }) },
    };
    const { columns } = activityBoard(state, NOW, NO_ACTIVITY_FILTER, false);
    expect(columns.needs_you.map((card) => [card.row.claudeSessionId, card.pending])).toEqual([
      ["c1", null],
    ]);
  });
});
