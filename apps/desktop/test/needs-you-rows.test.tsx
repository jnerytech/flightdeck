import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
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
      hosts: [{ id: "h", name: "alfa", status: "online", sessions: [] }],
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
  });
}
