import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { WorkflowsPage } = await import("../../src/features/workflows/page.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { memoryPlatform } = await import("../fixtures.ts");

afterEach(cleanup);

/**
 * Issue #3806: since #3799 the host refuses `workflow.trust` from a connection that is not near, so
 * the page does not offer it there. `host.info` says `near`; an older host does not say, and keeps
 * the button as it was.
 */
const WORKFLOW = { name: "feature", hash: "h1", trusted: false, checks: ["fd-test"], errors: [] };

const HINT = {
  en: "This works only from this computer or over Tailscale.",
  "pt-BR": "Isso só funciona neste computador ou pelo Tailscale.",
};
const TRUST = { en: "Trust feature", "pt-BR": "Confiar em feature" };

async function open(language: "en" | "pt-BR", near: boolean | undefined) {
  const real = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  real.i18n.start();
  const sent: string[] = [];
  const hostInfo = near === undefined ? {} : { near };
  // One state for every read: a new object each time would never settle.
  const state = { hosts: [{ id: "h1", hostInfo: { daemonVersion: "x", ...hostInfo } }] };
  const store = {
    hostCommand: async (_host: string, type: string) => {
      sent.push(type);
      return type === "workflow.list" ? { workflows: [WORKFLOW] } : {};
    },
    getState: () => state,
    subscribe: () => () => {},
  };
  await act(async () => {
    render(
      <TContext.Provider value={real.i18n.t}>
        <WorkflowsPage store={store as never} hostId="h1" projectId="p1" projectName="app" />
      </TContext.Provider>,
    );
  });
  return { sent };
}

const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

describe("workflows page on a far host (#3806)", () => {
  for (const language of ["en", "pt-BR"] as const) {
    test(`${language}: Trust is off with its hint, and a press opens nothing and sends nothing`, async () => {
      const { sent } = await open(language, false);
      const button = screen.queryByRole("button", { name: TRUST[language] });
      expect(button).not.toBeNull();
      expect(button?.hasAttribute("disabled")).toBe(true);
      // The hint is read with the button.
      const describedBy = button?.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(describedBy)?.textContent).toBe(HINT[language]);
      await act(async () => {
        fireEvent.click(button as HTMLElement);
      });
      expect(screen.queryByRole("alertdialog") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
      expect(sent).toEqual(["workflow.list"]);
    });
  }

  test("a near host, or one that does not say, keeps Trust working", async () => {
    for (const near of [true, undefined]) {
      cleanup();
      const { sent } = await open("en", near);
      const button = screen.queryByRole("button", { name: TRUST.en });
      expect(button?.hasAttribute("disabled")).toBe(false);
      expect(button?.getAttribute("aria-describedby")).toBeNull();
      await press(TRUST.en);
      expect(
        screen.queryByRole("alertdialog") !== null || screen.queryByRole("dialog") !== null,
      ).toBe(true);
      expect(sent).toEqual(["workflow.list"]);
    }
  });
});
