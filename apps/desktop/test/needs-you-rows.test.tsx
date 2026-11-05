import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

afterEach(() => cleanup());

/** Needs you with one open gate of a workflow run, on the card "Ship the cart". */
async function withGate(lang: "en" | "pt-BR") {
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
          sessions: [
            {
              id: "s1",
              name: "Backend tests",
              cwd: "/p",
              status: "idle",
              pendingPermissions: [
                {
                  requestId: "r1",
                  toolName: "Bash",
                  input: { command: "npm test --silent" },
                  createdAt: "2026-11-04T13:00:00Z",
                },
              ],
            },
          ],
        },
      ],
      cards: { "h/c1": { id: "c1", projectId: "p", title: "Ship the cart" } },
      runs: {
        "h/r1": {
          id: "r1",
          cardId: "c1",
          workflowName: "feature",
          steps: [
            {
              stepId: "review-plan",
              attempt: 1,
              type: "gate",
              status: "waiting",
              startedAt: "2026-11-04T12:00:00Z",
            },
          ],
        },
      },
    });
  });
  return store;
}

const rowText = () =>
  [...document.querySelectorAll("main li button, section li button")]
    .map((b) => b.textContent ?? "")
    .join(" | ");

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`needs-you-rows (${lang}): a row reads as a sentence`, () => {
    // Issue #175: the gate row read "gate review-plan", the internal tool name.
    test("an open workflow gate says which step waits for approval, not the internal name", async () => {
      await withGate(lang);
      const sentence = t.needsYou.gateRow.replace("{step}", "review-plan");
      expect(rowText()).toContain(sentence);
      expect(rowText()).not.toContain("gate review-plan");
      const row = document.querySelector(`button[aria-label*="Ship the cart"]`);
      expect(row?.getAttribute("aria-label")).toBe(`alfa · Ship the cart: ${sentence}`);
    });

    // OpenCode branch review M2: the detail pane and the tray still said "gate review-plan".
    test("the gate's detail pane names the step, not the internal tool name", async () => {
      await withGate(lang);
      const row = document.querySelector(`button[aria-label*="Ship the cart"]`) as HTMLElement;
      await act(async () => {
        fireEvent.click(row);
      });
      expect(document.body.textContent ?? "").not.toContain("gate review-plan");
      expect(document.body.textContent ?? "").toContain(
        t.needsYou.gateTool.replace("{step}", "review-plan"),
      );
    });

    test("the tray lists a gate by its step, not by the internal tool name", async () => {
      const { trayMenu } = await import("../src/lib/tray.ts");
      const { needsYou } = await import("../src/lib/app-store.ts");
      const store = await withGate(lang);
      const labels = trayMenu(needsYou(store.getState()), translator(lang)).items.map(
        (i) => i.label,
      );
      expect(labels).toContain(
        `alfa · Ship the cart · ${t.needsYou.gateRow.replace("{step}", "review-plan")}`,
      );
    });

    // OpenCode branch review m1: a row's name is the text it shows (WCAG 2.5.3).
    test("an ordinary request's row is named by what it shows: the tool and what it would do", async () => {
      await withGate(lang);
      const row = document.querySelector(`button[aria-label*="Backend tests"]`);
      expect(row?.getAttribute("aria-label")).toBe("alfa · Backend tests: Bash: npm test --silent");
    });

    // OpenCode branch review M1: a button's own style is align-items: flex-start, so the row's
    // detail line had no width to cut at; it ran past the row with no ellipsis.
    test("a row stretches its lines so the detail is cut with an ellipsis, and the full text is its tooltip", async () => {
      await withGate(lang);
      const row = document.querySelector(`button[aria-label*="Backend tests"]`) as HTMLElement;
      expect(row.className.split(" ")).toContain("items-stretch");
      const detail = [...row.querySelectorAll("span")].find(
        (span) => span.textContent === "Bash: npm test --silent",
      );
      expect(detail?.getAttribute("title")).toBe("Bash: npm test --silent");
    });
  });
}
