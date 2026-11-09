import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

afterEach(() => cleanup());

const session = (id: string, cwd: string, requestId: string) => ({
  id,
  name: "First card",
  cwd,
  status: "idle",
  pendingPermissions: [
    {
      requestId,
      toolName: "Bash",
      input: { command: "git status" },
      createdAt: "2026-11-09T10:00:00Z",
    },
  ],
});

/**
 * Issue #1545: two projects of the host "alfa", "loja" and "site", each with a card called
 * "First card" waiting on a request, and a gate of the card "Ship" in "loja".
 */
async function twoProjects(lang: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, lang).platform);
  render(<App store={store} />);
  await act(async () => {
    store.router.push({ name: "needs-you" });
    (store as unknown as { update(patch: object): void }).update({
      hosts: [
        {
          id: "h",
          name: "alfa",
          status: "online",
          sessions: [session("s1", "/w/loja-1", "r1"), session("s2", "/w/site-1", "r2")],
        },
      ],
      projects: {
        h: [
          { id: "p1", name: "loja", path: "/w/loja" },
          { id: "p2", name: "site", path: "/w/site" },
        ],
      },
      cards: {
        "h/c1": { id: "c1", projectId: "p1", title: "First card", sessionId: "s1" },
        "h/c2": { id: "c2", projectId: "p2", title: "First card", sessionId: "s2" },
        "h/c3": { id: "c3", projectId: "p1", title: "Ship", sessionId: null },
      },
      runs: {
        "h/run1": {
          id: "run1",
          cardId: "c3",
          workflowName: "feature",
          steps: [
            {
              stepId: "review-plan",
              attempt: 1,
              type: "gate",
              status: "waiting",
              startedAt: "2026-11-09T09:00:00Z",
            },
          ],
        },
      },
    });
  });
  return store;
}

const rowNames = () =>
  [...document.querySelectorAll("main li button")].map((b) => b.getAttribute("aria-label") ?? "");

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`needs-you-project (${lang}): a request names its project`, () => {
    test("Given two cards with the same title in two projects, Then their rows name each project", async () => {
      await twoProjects(lang);
      const names = rowNames();
      expect(names.some((n) => n.startsWith("alfa · loja · First card: "))).toBe(true);
      expect(names.some((n) => n.startsWith("alfa · site · First card: "))).toBe(true);
    });

    test("Given a gate of a card, Then its row names the card's project", async () => {
      await twoProjects(lang);
      const gate = `alfa · loja · Ship: ${t.needsYou.gateRow.replace("{step}", "review-plan")}`;
      expect(rowNames()).toContain(gate);
    });

    test("Given a row is chosen, Then its details say which host, project and card ask", async () => {
      await twoProjects(lang);
      const row = [...document.querySelectorAll("main li button")].find((b) =>
        (b.getAttribute("aria-label") ?? "").startsWith("alfa · site · First card: "),
      ) as HTMLElement | undefined;
      expect(row === undefined).toBe(false);
      await act(async () => {
        if (row) fireEvent.click(row);
      });
      const where = [...document.querySelectorAll("main p")].map((p) => p.textContent);
      expect(where).toContain("alfa · site · First card");
    });

    test("Given a session of no card, Then its row is host and session as before", async () => {
      const store = await twoProjects(lang);
      await act(async () => {
        (store as unknown as { update(patch: object): void }).update({ cards: {}, runs: {} });
      });
      expect(rowNames()).toEqual([
        "alfa · First card: Bash: git status",
        "alfa · First card: Bash: git status",
      ]);
    });
  });
}
