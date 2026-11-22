import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ActionsPage } = await import("../../src/features/actions/page.tsx");
const { en } = await import("../../src/i18n/en.ts");
const { ptBR } = await import("../../src/i18n/pt-BR.ts");
const { formatDateTime } = await import("../../src/i18n/format.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #3934: the history of an action opened while another one's request was still out replaced the
 * other's, because the answer wrote over a copy of the state taken before the wait. And a run's
 * output had no name, so a screen reader read raw text with no cue of which run it belongs to.
 */
const action = (name: string) => ({
  name,
  description: `Runs ${name}`,
  source: "app",
  projectId: "p1",
  host: null,
  ssh: null,
  run: [`./${name}.sh`],
  cwd: null,
  env: {},
  params: {},
  timeoutS: 60,
  approval: "ask",
  tags: [],
  secrets: { values: [], files: [] },
  trusted: true,
  changed: [],
  hash: name,
});
const runOf = (name: string) => ({
  id: `run-${name}`,
  name,
  projectId: "p1",
  requestedBy: "you",
  startedAt: "2026-11-13T10:00:00.000Z",
  durationMs: 1200,
  exitCode: 0,
  timedOut: false,
  truncated: false,
  output: `output of ${name}`,
});

async function openActions(language: "en" | "pt-BR") {
  const answers: Record<string, () => void> = {};
  const host = await fakeHostStore(
    {
      "actions.list": () => ({ actions: [action("build"), action("deploy")], errors: [] }),
      "actions.runs": (payload) => {
        const { name } = payload as { name: string };
        return new Promise((resolve) => {
          answers[name] = () => resolve({ runs: [runOf(name)] });
        });
      },
    },
    { hostId: "h1", language, fallback: {} },
  );
  host.store.i18n.start();
  render(<ActionsPage store={host.store} hostId="h1" projectId="p1" projectName="api" />);
  const open = (name: string) => within(document.body).queryByRole("button", { name });
  await settleMaybe(() => open(button(language, "build")) !== null, 3000);
  return { answers };
}

const button = (language: "en" | "pt-BR", name: string) =>
  (language === "en" ? en : ptBR).actionsUi.showRuns.replace("{name}", name);
const shows = (text: string) => document.body.textContent?.includes(text) ?? false;

const click = (name: string) =>
  act(async () => {
    const control = screen.queryByRole("button", { name });
    expect(control).not.toBeNull();
    fireEvent.click(control as HTMLElement);
  });

describe("runs-concurrent", () => {
  for (const language of ["en", "pt-BR"] as const) {
    for (const order of [
      ["build", "deploy"],
      ["deploy", "build"],
    ] as const) {
      test(`${language}: both histories show when the answers come as ${order.join(" then ")}`, async () => {
        const page = await openActions(language);
        await click(button(language, "build"));
        await click(button(language, "deploy"));
        for (const name of order) {
          await act(async () => {
            page.answers[name]?.();
          });
        }
        const both = await settleMaybe(
          () => shows("output of build") && shows("output of deploy"),
          3000,
        );
        expect(both).toBe(true);
      });
    }

    test(`${language}: a run's output is a named region that a keyboard can scroll`, async () => {
      const page = await openActions(language);
      await click(button(language, "build"));
      await act(async () => {
        page.answers.build?.();
      });
      await settleMaybe(() => shows("output of build"), 3000);
      const dictionary = language === "en" ? en : ptBR;
      // The page shows the start in this machine's zone, so the expected name asks for it the same way.
      const output = screen.queryByRole("region", {
        name: dictionary.actionsUi.runOutput
          .replace("{time}", formatDateTime(runOf("build").startedAt, language))
          .replace("{requester}", dictionary.actionsUi.requester.you),
      });
      expect(output).not.toBeNull();
      const text = output?.querySelector("pre");
      expect(text?.getAttribute("tabindex")).toBe("0");
      expect(text?.textContent).toContain("output of build");
    });
  }
});
