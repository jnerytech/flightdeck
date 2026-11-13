import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { useEffect, useState } from "react";
import { liveScreen, registerDom } from "../dom.ts";
import { settle, settleMaybe, stays } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppShell } = await import("../../src/features/shell/app-shell.tsx");
const { Page } = await import("../../src/shared/layout/page.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #1546 (round 14 of #168): a step that opens a page (Test and add, Add project, opening a card) left
 * the focus on the page body, so a screen reader said nothing about the new page and the next Tab
 * started at the top of the app. When the navigation lost the focus, it goes to the new page's heading.
 */
const LABELS = { sidebar: "Side", collapse: "Collapse", expand: "Expand", skip: "Skip" };

/** A page that is still loading: its Page, and so its heading, comes a moment later. */
function Late() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(timer);
  }, []);
  return ready ? (
    <Page key="late" title="beta">
      <button type="button">Later</button>
    </Page>
  ) : (
    <p>Loading…</p>
  );
}

/** A tiny app: a form page whose button goes to the next page, and a page with its own control. */
function Harness() {
  const [route, setRoute] = useState<"form" | "host" | "late">("form");
  return (
    <AppShell
      header={<button type="button">Menu</button>}
      sidebar={() => (
        <>
          <button type="button" onClick={() => setRoute("host")}>
            Go from the sidebar
          </button>
          <button type="button" onClick={() => setRoute("late")}>
            Go to the slow page
          </button>
        </>
      )}
      labels={LABELS}
      navKey={route}
    >
      {route === "late" ? (
        <Late />
      ) : route === "form" ? (
        <Page key="form" title="Connect your first host">
          <button type="button" onClick={() => setRoute("host")}>
            Test and add
          </button>
        </Page>
      ) : (
        <Page key="host" title="alfa">
          <button type="button">Add project</button>
        </Page>
      )}
    </AppShell>
  );
}

/**
 * Add project in a real browser (#1580): the page opens while the dialog that gave the command is still
 * closing, and the browser takes no focus on the page behind it until the dialog is gone. The dialog's
 * button is disabled while the command runs, so the focus is lost when the page opens.
 */
function Closing(props: Readonly<{ closeAfter: number }>) {
  const [route, setRoute] = useState<"list" | "project">("list");
  const [dialog, setDialog] = useState(true);
  return (
    <AppShell
      header={
        <>
          <button type="button">Menu</button>
          {dialog && (
            <section role="dialog" aria-label="Add project dialog">
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.blur();
                  setRoute("project");
                  setTimeout(() => setDialog(false), props.closeAfter);
                }}
              >
                Add
              </button>
            </section>
          )}
        </>
      }
      sidebar={() => <button type="button">Side</button>}
      labels={LABELS}
      navKey={route}
    >
      <Page key={route} title={route === "list" ? "Projects" : "setup"}>
        <button type="button">{route === "list" ? "New project" : "Open board"}</button>
      </Page>
    </AppShell>
  );
}

/** Like a modal dialog in a browser: while one is open, `focus()` on anything outside it does nothing. */
const realFocus = HTMLElement.prototype.focus;
function refuseFocusBehindDialogs() {
  HTMLElement.prototype.focus = function focus(this: HTMLElement, options?: FocusOptions) {
    if (document.querySelector("[role=dialog]") && !this.closest("[role=dialog]")) return;
    realFocus.call(this, options);
  };
}
afterEach(() => {
  HTMLElement.prototype.focus = realFocus;
});

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
    expect(document.activeElement === document.body).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("focus the person already has on a control that stays is left where it is", async () => {
    render(<Harness />);
    const side = screen.queryByRole("button", { name: "Go from the sidebar" });
    side?.focus();
    await act(async () => {
      if (side) fireEvent.click(side);
    });
    await settle(() => title()?.textContent === "alfa");
    expect(document.activeElement === side).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a page that is still loading takes the focus when its heading comes, if the step lost it", async () => {
    render(<Harness />);
    const step = screen.queryByRole("button", { name: "Test and add" });
    step?.focus();
    // The sidebar button stays, so the focus is moved off to the removed step: the page's own, lost.
    const go = screen.queryByRole("button", { name: "Go to the slow page" });
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      if (go) fireEvent.click(go);
    });
    (document.activeElement as HTMLElement | null)?.blur();
    await settle(() => title()?.textContent === "beta", 5000, "the heading of the slow page");
    await settle(() => document.activeElement === title(), 5000, "focus on the late heading");
    expect(document.activeElement === title()).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a control the person moved to while the page loaded keeps the focus when the heading comes", async () => {
    render(<Harness />);
    const go = screen.queryByRole("button", { name: "Go to the slow page" });
    await act(async () => {
      if (go) fireEvent.click(go);
    });
    (document.activeElement as HTMLElement | null)?.blur();
    const menu = screen.queryByRole("button", { name: "Menu" });
    menu?.focus();
    await settle(() => title()?.textContent === "beta", 5000, "the heading of the slow page");
    await stays(() => document.activeElement === menu, 300, "focus stays on the control");
    expect(document.activeElement === menu).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("the browser refuses the focus while the dialog that gave the command closes: the heading takes it when the dialog goes", async () => {
    refuseFocusBehindDialogs();
    render(<Closing closeAfter={120} />);
    const add = screen.queryByRole("button", { name: "Add" });
    add?.focus();
    await act(async () => {
      if (add) fireEvent.click(add);
    });
    await settle(() => title()?.textContent === "setup", 5000, "the project's page");
    expect(document.activeElement === title()).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    await settle(() => screen.queryByRole("button", { name: "Add" }) === null, 5000, "dialog gone");
    const taken = await settleMaybe(() => document.activeElement === title(), 2000);
    expect(taken).toBe(true);
  });
});
