import { describe, expect, test } from "bun:test";
import type { ExternalSession } from "@flightdeck/protocol";
import { translator } from "../../src/i18n/index.ts";
import { externalState, type HubRow, hubRows, rowStatus } from "../../src/lib/hub.ts";

/**
 * Issue #1736: a session started in a terminal that waits at a plan approval or a question has a
 * state of its own in the list: it needs the person, whatever its hooks last said.
 */
const NOW = Date.parse("2026-11-10T12:00:00.000Z");

const external = (over: Partial<ExternalSession>): ExternalSession => ({
  claudeSessionId: "c1",
  cwd: "/w",
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

const rowsOf = (...sessions: ExternalSession[]) =>
  hubRows({
    hosts: [{ id: "h", name: "alfa", sessions: [] }],
    hub: { h: { managed: [], history: [] } },
    meta: {},
    externals: Object.fromEntries(sessions.map((s) => [`h/${s.claudeSessionId}`, s])),
    names: {},
    background: {},
  } as never);

describe("hub-external-waiting: a terminal session at a prompt needs you (#1736)", () => {
  test("a plan or a question waiting makes the row need you, whatever its status", () => {
    const rows = rowsOf(
      external({ claudeSessionId: "a", status: "idle", waiting: "plan" }),
      external({ claudeSessionId: "b", status: "running", waiting: "question" }),
      external({ claudeSessionId: "c", status: "unknown", waiting: "plan" }),
    );
    expect(rows.map((r) => [r.claudeSessionId, r.state, r.waiting])).toEqual([
      ["a", "needs_you", "plan"],
      ["b", "needs_you", "question"],
      ["c", "needs_you", "plan"],
    ]);
  });

  test("a session that waits for nothing keeps the state its status gives", () => {
    const rows = rowsOf(
      external({ claudeSessionId: "a", status: "idle" }),
      external({ claudeSessionId: "b", status: "running", waiting: null }),
    );
    expect(rows.map((r) => [r.claudeSessionId, r.state, r.waiting])).toEqual([
      ["a", "idle", undefined],
      ["b", "running", undefined],
    ]);
  });

  test("a session that ended is over, whatever it waited at: it is not one that needs you", () => {
    const ended = external({ status: "ended", waiting: "plan" });
    expect(externalState(ended)).toBe("ended");
    expect(rowsOf(ended).map((r) => [r.state, r.waiting])).toEqual([["ended", undefined]]);
  });

  test("one rule gives the state of a terminal session for the list and for its own page", () => {
    expect(
      [
        external({ status: "idle", waiting: "question" }),
        external({ status: "running", waiting: "plan" }),
        external({ status: "unknown", waiting: null }),
        external({ status: "awaiting_permission" }),
      ].map(externalState),
    ).toEqual(["needs_you", "needs_you", "idle", "needs_you"]);
  });

  for (const [language, plan, question] of [
    ["en", "plan waiting for your approval", "has a question for you"],
    ["pt-BR", "plano esperando sua aprovação", "tem uma pergunta para você"],
  ] as const) {
    test(`${language}: the row says which prompt it waits at`, () => {
      const t = translator(language);
      const base: Partial<HubRow> = { state: "needs_you", origin: "terminal", summary: null };
      const said = (waiting: "plan" | "question") =>
        rowStatus(
          {
            key: "k",
            hostId: "h",
            hostName: "alfa",
            claudeSessionId: "c1",
            sessionId: null,
            title: "t",
            cwd: "/w",
            projectKey: "p",
            controllable: false,
            lastActivity: "2026-11-10T11:57:00.000Z",
            pinned: false,
            archived: false,
            persona: null,
            ...base,
            waiting,
          } as HubRow,
          NOW,
          t,
        ).detail;
      expect([said("plan"), said("question")]).toEqual([plan, question]);
    });
  }
});
