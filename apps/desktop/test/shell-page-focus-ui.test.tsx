import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { useState } from "react";
import { liveScreen, registerDom } from "./dom.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppShell } = await import("../src/components/layout/app-shell.tsx");
const { Page } = await import("../src/components/layout/page.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #1546 (round 14 of #168): a step that opens a page (Test and add, Add project, opening a card) left
 * the focus on the page body, so a screen reader said nothing about the new page and the next Tab
 * started at the top of the app. When the navigation lost the focus, it goes to the new page's heading.
 */
const LABELS = { sidebar: "Side", collapse: "Collapse", expand: "Expand", skip: "Skip" };

/** A tiny app: a form page whose button goes to the next page, and a page with its own control. */
function Harness() {
  const [route, setRoute] = useState<"form" | "host">("form");
  return (
    <AppShell
      header={<button type="button">Menu</button>}
      sidebar={() => (
        <button type="button" onClick={() => setRoute("host")}>
          Go from the sidebar
        </button>
      )}
      labels={LABELS}
      navKey={route}
    >
      {route === "form" ? (
        <Page title="Connect your first host">
          <button type="button" onClick={() => setRoute("host")}>
            Test and add
          </button>
        </Page>
      ) : (
        <Page title="alfa">
          <button type="button">Add project</button>
        </Page>
      )}
    </AppShell>
  );
}

const title = () => document.querySelector<HTMLElement>("[data-slot=page-title]");

describe("shell-page-focus-ui: a page that opens takes the focus when the step lost it (#1546)", () => {
  test("the button that opened the page is gone: focus goes to the new page's heading", async () => {
    render(<Harness />);
    const step = screen.queryByRole("button", { name: "Test and add" });
    step?.focus();
    await act(async () => {
      if (step) fireEvent.click(step);
    });
    await settle(() => title()?.textContent === "alfa");
    expect([document.activeElement === title(), title()?.getAttribute("tabindex")]).toEqual([
      true,
      "-1",
    ]);
  });

  test("the page that is there when the app starts does not take the focus", async () => {
    render(<Harness />);
    await act(async () => {});
    expect(document.activeElement === document.body).toBe(true);
  });

  test("focus the person already has on a control that stays is left where it is", async () => {
    render(<Harness />);
    const side = screen.queryByRole("button", { name: "Go from the sidebar" });
    side?.focus();
    await act(async () => {
      if (side) fireEvent.click(side);
    });
    await settle(() => title()?.textContent === "alfa");
    expect(document.activeElement === side).toBe(true);
  });
});
