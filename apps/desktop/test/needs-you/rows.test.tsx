import { afterEach, describe, expect, test } from "bun:test";
import { readStyles } from "../../../../scripts/lib/styles/styles-source.ts";
import { en } from "../../src/i18n/en.ts";
import { translator } from "../../src/i18n/index.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

afterEach(() => cleanup());

/** Needs you with one open gate of a workflow run, on the card "Ship the cart". */
async function withGate(
  lang: "en" | "pt-BR",
  risk: {
    risk?: "low" | "medium" | "high";
    riskReason?: string;
    toolName?: string;
    input?: object;
  } = {},
) {
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
                  ...risk,
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
      const { trayMenu } = await import("../../src/features/tray/domain/tray.ts");
      const { needsYou } = await import("../../src/lib/app-store.ts");
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

    // Issue #3918: the risk showed only on the card, so a stack of requests looked alike.
    test("a request with a risk shows the card's seal on its row, and the risk word is in its name", async () => {
      await withGate(lang, { risk: "high", riskReason: "deletes files" });
      const row = document.querySelector(`button[aria-label*="Backend tests"]`) as HTMLElement;
      const seal = row.querySelector("[data-risk]");
      expect({
        risk: seal?.getAttribute("data-risk"),
        word: seal?.textContent,
        reason: seal?.getAttribute("title"),
        name: row.getAttribute("aria-label"),
      }).toEqual({
        risk: "high",
        word: t.approval.risk.high,
        reason: "deletes files",
        name: `alfa · Backend tests (${t.approval.risk.high}): Bash: npm test --silent`,
      });
    });

    // weaker: happy-dom has no layout, so the classes are all a test can read; the 390 px print checks the result
    test("the seal keeps its width on a narrow row: it neither shrinks nor wraps", async () => {
      await withGate(lang, { risk: "medium" });
      const holder = document.querySelector(
        `button[aria-label*="Backend tests"] [data-risk]`,
      )?.parentElement;
      expect(holder?.className.split(" ")).toEqual(
        expect.arrayContaining(["shrink-0", "whitespace-nowrap"]),
      );
    });

    test("a question or a plan shows no seal on its row, as its card shows none", async () => {
      await withGate(lang, {
        risk: "medium",
        toolName: "ExitPlanMode",
        input: { plan: "Ship it" },
      });
      const row = document.querySelector(`button[aria-label*="Backend tests"]`) as HTMLElement;
      expect({
        seal: row.querySelector("[data-risk]") !== null,
        riskInName: (row.getAttribute("aria-label") ?? "").includes(t.approval.risk.medium),
      }).toEqual({ seal: false, riskInName: false });
    });

    test("a request with no risk has no seal and keeps its name", async () => {
      await withGate(lang);
      const row = document.querySelector(`button[aria-label*="Backend tests"]`) as HTMLElement;
      expect({
        seal: row.querySelector("[data-risk]") !== null,
        name: row.getAttribute("aria-label"),
      }).toEqual({ seal: false, name: "alfa · Backend tests: Bash: npm test --silent" });
    });

    test("a request whose risk changes redraws its row: the seal and the name follow, and none is left when the risk goes", async () => {
      const store = await withGate(lang, { risk: "low" });
      const row = () =>
        document.querySelector(`button[aria-label*="Backend tests"]`) as HTMLElement;
      const look = () => ({
        seal: row().querySelector("[data-risk]")?.textContent ?? null,
        name: row().getAttribute("aria-label"),
      });
      const setRisk = async (risk: object) => {
        const host = store.getState().hosts[0] as {
          sessions: Array<{ pendingPermissions: object[] }>;
        };
        const permission = {
          requestId: "r1",
          toolName: "Bash",
          input: { command: "npm test --silent" },
          createdAt: "2026-11-04T13:00:00Z",
          ...risk,
        };
        await act(async () => {
          (store as unknown as { update(patch: object): void }).update({
            hosts: [
              { ...host, sessions: [{ ...host.sessions[0], pendingPermissions: [permission] }] },
            ],
          });
        });
      };
      const low = look();
      await setRisk({ risk: "high" });
      const high = look();
      await setRisk({});
      expect([low, high, look()]).toEqual([
        {
          seal: t.approval.risk.low,
          name: `alfa · Backend tests (${t.approval.risk.low}): Bash: npm test --silent`,
        },
        {
          seal: t.approval.risk.high,
          name: `alfa · Backend tests (${t.approval.risk.high}): Bash: npm test --silent`,
        },
        { seal: null, name: "alfa · Backend tests: Bash: npm test --silent" },
      ]);
    });

    test("a row's detail starts under its title, past the status dot (#588)", async () => {
      await withGate(lang);
      const row = document.querySelector(`button[aria-label*="Backend tests"]`) as HTMLElement;
      const detail = [...row.querySelectorAll("span")].find(
        (span) => span.textContent === "Bash: npm test --silent",
      );
      expect(detail?.className.split(" ") ?? []).toContain("pl-5");
    });
  });
}

describe("needs-you-rows: every button that stacks lines gives them its width", () => {
  // The cause is the browser's style for <button> (align-items: flex-start), which Tailwind's reset
  // leaves: any button with flex-col and a cut line ran past its box. The base layer resets it.
  test("the base layer sets align-items: stretch on buttons", async () => {
    const css = readStyles(new URL("../../src/styles.css", import.meta.url));
    const base = css.slice(
      css.indexOf("@layer base {"),
      css.indexOf("\n}\n", css.indexOf("@layer base {")),
    );
    expect(/\n {2}button \{\n {4}align-items: stretch;\n {2}\}/.test(base)).toBe(true);
  });
});
