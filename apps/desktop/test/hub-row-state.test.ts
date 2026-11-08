import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { translator } from "../src/i18n/index.ts";
import {
  type HubGroup,
  type HubRow,
  hubRows,
  hubView,
  loadHubFilter,
  rowStatus,
} from "../src/lib/hub.ts";

/**
 * Issue #1132: each row of the sessions list says what the session is doing: a state word and one
 * detail, from the session's own line. A daemon `error` and a background `failed` are Failed, not
 * Ended like a session closed on purpose.
 */
const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const row = (over: Partial<HubRow>): HubRow => ({
  key: "h/m/s1",
  hostId: "h",
  hostName: "alfa",
  origin: "flightdeck",
  claudeSessionId: "c1",
  sessionId: "s1",
  title: "Tests",
  cwd: "/w",
  projectKey: "p",
  state: "idle",
  controllable: false,
  lastActivity: "2026-11-08T11:57:00.000Z",
  pinned: false,
  archived: false,
  summary: null,
  persona: null,
  ...over,
});
const line = (state: "running" | "waiting" | "idle" | "ended", tool: string | null) => ({
  request: "Fix the cart",
  state,
  tool,
  since: "2026-11-08T11:57:00.000Z",
});

describe("hub-row-state: a daemon error and a failed background session are Failed (#1132)", () => {
  test("they map to failed, while a session closed on purpose stays ended", () => {
    const state = {
      hosts: [{ id: "h", name: "alfa", sessions: [] }],
      hub: {
        h: {
          managed: [
            { id: "s1", claudeSessionId: "c1", cwd: "/w", status: "error", updatedAt: "x" },
            { id: "s2", claudeSessionId: "c2", cwd: "/w", status: "ended", updatedAt: "x" },
          ],
          history: [],
        },
      },
      meta: {},
      externals: {},
      names: {},
      background: {
        h: {
          sessions: [
            { id: "b1", claudeSessionId: null, cwd: "/w", state: "failed", startedAt: null },
          ],
        },
      },
    } as never;
    const states = Object.fromEntries(hubRows(state).map((r) => [r.key, r.state]));
    expect(states).toEqual({ "h/m/s1": "failed", "h/m/s2": "ended", "h/b/b1": "failed" });
  });
});

describe("hub-row-state: each row's word and detail (#1132)", () => {
  for (const [language, expected] of [
    [
      "en",
      [
        ["Waiting for you", "wants to run Bash"],
        ["Working", "running Edit"],
        ["Working", ""],
        ["Idle", "3 min ago"],
        ["Ended", "3 min ago"],
        ["Failed", "3 min ago"],
      ],
    ],
    [
      "pt-BR",
      [
        ["Esperando você", "quer rodar Bash"],
        ["Trabalhando", "rodando Edit"],
        ["Trabalhando", ""],
        ["Ociosa", "há 3 min"],
        ["Encerrada", "há 3 min"],
        ["Falhou", "há 3 min"],
      ],
    ],
  ] as const) {
    test(`${language}: waiting, running, finished, ended and failed rows say so`, () => {
      const t = translator(language);
      const said = [
        row({ state: "needs_you", summary: line("waiting", "Bash") }),
        row({ state: "running", summary: line("running", "Edit") }),
        row({ state: "running", summary: null }),
        row({ state: "idle", summary: line("idle", null) }),
        row({ state: "ended", summary: line("ended", null) }),
        row({ state: "failed" as HubRow["state"], summary: null }),
      ].map((r) => {
        const { word, detail } = rowStatus(r, NOW, t);
        return [word, detail];
      });
      expect(said).toEqual(expected.map((pair) => [...pair]));
    });
  }
});

// ux-review of #1132: a failed session is over, like an ended one: it folds into the earlier
// sessions and is not counted as active, and a kept Failed filter survives a reload.
describe("hub-row-state: a failed session is over, like an ended one (#1132)", () => {
  test("it goes to the earlier sessions, not the live ones", () => {
    const group = {
      key: "g",
      foldKey: "g",
      name: "api",
      rows: [
        row({ key: "a", state: "running" }),
        row({ key: "b", state: "failed" as HubRow["state"] }),
        row({ key: "c", state: "ended" }),
      ],
    } as unknown as HubGroup;
    const [view] = hubView([group], { g: true }, {}, false);
    expect([view?.live.map((r) => r.key), view?.earlier.map((r) => r.key).sort()]).toEqual([
      ["a"],
      ["b", "c"],
    ]);
  });

  test("a kept Failed filter comes back on reload", () => {
    const storage = { getItem: () => JSON.stringify({ state: "failed" }) };
    expect(loadHubFilter(storage).state).toBe("failed");
  });
});

// #1144's e2e (sleep-wake): in the compact 32 px row the status line and the Asleep mark took the
// whole width and the title shrank to nothing, so it could not be clicked. The title keeps a
// minimum and the status gives way first. happy-dom has no layout: this reads the rules, and the
// journey and the 390 print check the fit.
describe("hub-row-state: the title keeps its room beside the status (#1132)", () => {
  const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
  const block = (name: string) =>
    css.match(new RegExp(`@utility ${name} \\{([^}]*)\\}`))?.[1] ?? "";
  test("the row's title has a minimum width, and the status line shrinks before it", () => {
    const hub = readFileSync(join(import.meta.dir, "../src/ui/SessionsHub.tsx"), "utf8");
    expect([
      /min-width: min\(/.test(block("row-title")),
      /flex-shrink: (\d+)/.exec(block("row-status"))?.[1] !== undefined &&
        Number(/flex-shrink: (\d+)/.exec(block("row-status"))?.[1]) > 1,
      hub.includes("row-title"),
    ]).toEqual([true, true, true]);
  });
});
