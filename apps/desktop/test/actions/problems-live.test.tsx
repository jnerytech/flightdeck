import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { RequestError } from "../../src/features/hosts/host-connection.ts";
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
 * #2610: the problems of the actions file were red lines with no title and no announcement, and
 * the form's error could be below the fold of a long dialog.
 */
async function openActions(errors: string[], save?: () => never) {
  const host = await fakeHostStore(
    {
      "actions.list": () => ({ actions: [], errors }),
      ...(save ? { "actions.save": save } : {}),
    },
    { hostId: "h1", language: "en", fallback: {} },
  );
  host.store.i18n.start();
  render(<ActionsPage store={host.store} hostId="h1" projectId="p1" projectName="api" />);
}

describe("problems-live", () => {
  test("the problems of the file have a visible heading, are a list and are announced", async () => {
    await openActions(["actions.yaml: line 3 is not valid"]);
    await settleMaybe(
      () => screen.queryByRole("heading", { name: "Problems in the actions file" }) !== null,
      3000,
    );
    expect(screen.queryByRole("heading", { name: "Problems in the actions file" })).not.toBeNull();
    const notice = screen.queryByRole("alert");
    expect(notice).not.toBeNull();
    expect(
      within(notice as HTMLElement)
        .queryAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["actions.yaml: line 3 is not valid"]);
  });

  test("a form error scrolls into view when it shows", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      await openActions([], () => {
        throw new RequestError("invalid", "name is taken");
      });
      await settleMaybe(() => screen.queryByRole("button", { name: "New action" }) !== null, 3000);
      await act(async () => {
        fireEvent.click(screen.getAllByRole("button", { name: "New action" })[0] as HTMLElement);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      await settleMaybe(() => screen.queryAllByRole("alert").length > 0, 3000);
      const notice = screen
        .queryAllByRole("alert")
        .find((el) => el.textContent?.includes("name is taken"));
      expect(notice).toBeDefined();
      expect(scrolled.includes(notice as Element)).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
