import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ActionsPage } = await import("../../src/features/actions/page.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #2610: the Runs button of an action did not say whether its runs were open, and a second press
 * while the first request was out sent a second `actions.runs`.
 */
const action = {
  name: "deploy",
  description: "Deploys",
  source: "app",
  projectId: "p1",
  host: null,
  ssh: null,
  run: ["./deploy.sh"],
  cwd: null,
  env: {},
  params: {},
  timeoutS: 60,
  approval: "ask",
  tags: [],
  secrets: { values: [], files: [] },
  trusted: true,
  changed: [],
  hash: "h",
};
const run = {
  id: "r1",
  name: "deploy",
  projectId: "p1",
  requestedBy: "user",
  startedAt: "2026-11-13T10:00:00.000Z",
  durationMs: 1200,
  exitCode: 0,
  timedOut: false,
  truncated: false,
  output: "done",
};

async function openActions() {
  let asked = 0;
  let answer: (() => void) | undefined;
  const host = await fakeHostStore(
    {
      "actions.list": () => ({ actions: [action], errors: [] }),
      "actions.runs": () => {
        asked += 1;
        return new Promise((resolve) => {
          answer = () => resolve({ runs: [run] });
        });
      },
    },
    { hostId: "h1", language: "en", fallback: {} },
  );
  host.store.i18n.start();
  render(<ActionsPage store={host.store} hostId="h1" projectId="p1" projectName="api" />);
  await settleMaybe(() => runsButton() !== null, 3000);
  return { asked: () => asked, answer: () => answer?.() };
}

const runsButton = () => screen.queryByRole("button", { name: "Runs of deploy" });
const hideButton = () => screen.queryByRole("button", { name: "Hide runs of deploy" });
const click = (button: HTMLElement | null) =>
  act(async () => {
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLElement);
  });

describe("runs-toggle-state", () => {
  test("the Runs button says it is closed, and open once the runs show, and points at them", async () => {
    const page = await openActions();
    expect(runsButton()?.getAttribute("aria-expanded")).toBe("false");
    await click(runsButton());
    await act(async () => {
      page.answer();
    });
    await settleMaybe(() => hideButton() !== null, 3000);
    const open = hideButton();
    expect(open).not.toBeNull();
    expect(open?.getAttribute("aria-expanded")).toBe("true");
    const controls = open?.getAttribute("aria-controls") ?? "";
    expect(controls).not.toBe("");
    expect(document.getElementById(controls)?.textContent).toContain("done");
  });

  test("a second press while the first request is out sends no second request", async () => {
    const page = await openActions();
    await click(runsButton());
    expect(page.asked()).toBe(1);
    expect(runsButton()?.getAttribute("aria-busy")).toBe("true");
    await click(runsButton());
    await click(runsButton());
    expect(page.asked()).toBe(1);
    await act(async () => {
      page.answer();
    });
    await settleMaybe(() => hideButton() !== null, 3000);
    expect(hideButton()?.getAttribute("aria-busy")).toBeNull();
  });
});
