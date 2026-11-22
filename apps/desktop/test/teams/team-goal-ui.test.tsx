import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TeamsPage } = await import("../../src/features/teams/page.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");

/**
 * Issue #4023: a team's goal is named, shows before the Outcome box, breaks a long word inside the
 * card, and a long one is clamped to three lines with a control to read all of it. The test
 * DOM has no layout, so the box's height is stubbed: the card clamps when its text is taller than
 * the clamped box, as a browser would measure it.
 */
const AT = "2026-11-08T10:00:00.000Z";
const URL_WORD = `https://example.com/${"a".repeat(120)}`;
const LONG_GOAL = Array.from({ length: 40 }, (_, i) => `Step ${i + 1} of the brief.`).join("\n");

const teamOf = (goal: string) => ({
  id: "t1",
  name: "login",
  projectId: "p1",
  goal,
  coordinator: "s-c",
  checks: [],
  state: "active",
  pausedBy: null,
  instructionsVersion: "2",
  createdAt: AT,
  members: [
    {
      name: "login · coordinator",
      role: "coordinator",
      persona: null,
      model: null,
      cardId: null,
      sessionId: "s-c",
      address: null,
      sessionState: "idle",
    },
  ],
});

let tall = false;
const originals = {
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
};
beforeEach(() => {
  tall = false;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return tall && this.dataset.slot === "team-goal-text" ? 400 : 40;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return this.dataset.slot === "team-goal-text" ? 60 : 0;
    },
  });
});
afterEach(() => {
  cleanup();
  for (const key of ["scrollHeight", "clientHeight"] as const) {
    const original = originals[key];
    if (original) Object.defineProperty(HTMLElement.prototype, key, original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
});

function open(lang: "en" | "pt-BR", goal: string) {
  const team = teamOf(goal);
  const { platform } = memoryPlatform(false, lang);
  const store = new AppStore(platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.projectList.load = async () => null;
  store.hostCommand = (async (_host: string, type: string) => {
    if (type === "teams.list") return { teams: [team] };
    if (type === "teams.status") {
      return {
        team,
        messages: 0,
        members: team.members.map((m) => ({ ...m, lastReport: null, sent: 0, received: 0 })),
        outcome: { text: "Login merged.", at: AT, done: false },
      };
    }
    return null;
  }) as never;
  store.hostRequest = (async () => ({ ok: false, code: "x", message: "x" })) as never;
  act(() =>
    (store as unknown as { update(patch: object): void }).update({
      hosts: [
        {
          id: "h1",
          name: "alfa",
          url: "ws://x",
          token: "",
          status: "online",
          info: null,
          hostInfo: { daemonVersion: "x", features: ["teams"] },
          incompatibility: null,
          daemonUpdate: null,
          sessions: [],
        },
      ],
    }),
  );
  render(
    <TooltipProvider>
      <TeamsPage store={store} go={() => {}} />
    </TooltipProvider>,
  );
}

const WORDS = {
  en: { goal: "Goal", outcome: "Outcome", more: "Show more", less: "Show less" },
  "pt-BR": { goal: "Objetivo", outcome: "Resultado", more: "Mostrar mais", less: "Mostrar menos" },
} as const;

describe("team-goal-ui: the team's goal (#4023)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    const w = WORDS[lang];
    const goalBox = () => screen.queryByRole("region", { name: w.goal });
    const moreButton = () => screen.queryByRole("button", { name: w.more });

    test(`${lang}: the goal has a name and comes before the Outcome box`, async () => {
      open(lang, "Implement the login.");
      await settleMaybe(() => screen.queryByRole("region", { name: w.outcome }) !== null);
      const goal = goalBox();
      const outcome = screen.queryByRole("region", { name: w.outcome });
      expect([
        goal !== null,
        goal?.textContent?.includes("Implement the login.") ?? false,
        goal && outcome
          ? Boolean(goal.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING)
          : false,
      ]).toEqual([true, true, true]);
    });

    test(`${lang}: a goal that fits has no control`, async () => {
      open(lang, "Implement the login.");
      await settleMaybe(() => goalBox() !== null);
      expect([goalBox() !== null, moreButton() === null]).toEqual([true, true]);
    });

    test(`${lang}: a long goal is clamped, and the control shows all of it and then clamps it again`, async () => {
      tall = true;
      open(lang, LONG_GOAL);
      await settleMaybe(() => moreButton() !== null);
      const text = () => goalBox()?.querySelector('[data-slot="team-goal-text"]') ?? null;
      const clamped = () => text()?.className.includes("line-clamp-3") ?? false;
      const state = () => [
        clamped(),
        moreButton()?.getAttribute("aria-expanded") ?? null,
        screen.queryByRole("button", { name: w.less }) !== null,
      ];
      expect(state()).toEqual([true, "false", false]);
      await act(async () => {
        fireEvent.click(moreButton() as Element);
      });
      expect([
        clamped(),
        screen.queryByRole("button", { name: w.less })?.getAttribute("aria-expanded"),
      ]).toEqual([false, "true"]);
      expect(text()?.textContent).toBe(LONG_GOAL);
      await act(async () => {
        fireEvent.click(screen.queryByRole("button", { name: w.less }) as Element);
      });
      expect(state()).toEqual([true, "false", false]);
    });

    test(`${lang}: a long word breaks inside the card`, async () => {
      open(lang, `See ${URL_WORD}`);
      await settleMaybe(() => goalBox() !== null);
      const text = goalBox()?.querySelector('[data-slot="team-goal-text"]');
      expect([
        text?.className.includes("[overflow-wrap:anywhere]") ?? false,
        goalBox()?.className.includes("min-w-0") ?? false,
      ]).toEqual([true, true]);
    });
  }
});
