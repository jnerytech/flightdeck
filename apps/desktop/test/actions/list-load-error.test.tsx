import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ActionsPage } = await import("../../src/features/actions/page.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #2609: an actions list whose `actions.list` failed used to stay in its loading shape for good,
 * because the toast's Retry threw the answer away. The page now says the request failed and retries.
 */
async function openActions(answers: Array<"fail" | "ok" | "hang">) {
  const queue = [...answers];
  let lists = 0;
  const host = await fakeHostStore(
    {
      "actions.list": () => {
        lists += 1;
        const answer = queue.shift() ?? "ok";
        if (answer === "hang") return new Promise(() => {});
        if (answer === "fail") throw new RequestError("internal", "host is down");
        return { actions: [], errors: [] };
      },
    },
    { hostId: "h1", language: "en", fallback: {} },
  );
  host.store.i18n.start();
  const page = (projectId: string) => (
    <ActionsPage store={host.store} hostId="h1" projectId={projectId} projectName="api" />
  );
  const view = render(page("p1"));
  return { lists: () => lists, goTo: (projectId: string) => view.rerender(page(projectId)) };
}

const retry = () => screen.queryByRole("button", { name: "Try again" });
const loading = () => screen.queryByRole("status", { name: "Loading actions" });
const empty = () => screen.queryByText("No actions in this project");

describe("list-load-error", () => {
  test("a failed list request shows an error with a retry, not the loading shape", async () => {
    await openActions(["fail"]);
    await settleMaybe(() => retry() !== null, 3000);
    expect(retry()).not.toBeNull();
    expect(loading()).toBeNull();
    expect(screen.queryByRole("alert")?.textContent).toContain("The actions did not load.");
  });

  test("the retry, once the host answers, shows the list", async () => {
    const page = await openActions(["fail", "ok"]);
    await settleMaybe(() => retry() !== null, 3000);
    expect(retry()).not.toBeNull();
    await act(async () => {
      fireEvent.click(retry() as HTMLElement);
    });
    await settleMaybe(() => empty() !== null, 3000);
    expect(empty()).not.toBeNull();
    expect(page.lists()).toBe(2);
    expect(retry()).toBeNull();
  });

  test("a retry that fails again keeps the error", async () => {
    await openActions(["fail", "fail"]);
    await settleMaybe(() => retry() !== null, 3000);
    expect(retry()).not.toBeNull();
    await act(async () => {
      fireEvent.click(retry() as HTMLElement);
    });
    await settleMaybe(() => retry() !== null, 3000);
    expect(retry()).not.toBeNull();
    expect(loading()).toBeNull();
  });

  test("a list that loads at first shows the loading shape, then the list", async () => {
    await openActions(["ok"]);
    await settleMaybe(() => empty() !== null, 3000);
    expect(empty()).not.toBeNull();
    expect(retry()).toBeNull();
  });

  test("while a retry is out, the error gives way to the loading shape", async () => {
    await openActions(["fail", "hang"]);
    await settleMaybe(() => retry() !== null, 3000);
    await act(async () => {
      fireEvent.click(retry() as HTMLElement);
    });
    await settleMaybe(() => loading() !== null, 3000);
    expect(loading()).not.toBeNull();
    expect(retry()).toBeNull();
  });

  test("a reload that fails over a list already shown says so, with the retry", async () => {
    const page = await openActions(["ok", "fail"]);
    await settleMaybe(() => empty() !== null, 3000);
    await act(async () => {
      page.goTo("p2");
    });
    await settleMaybe(() => retry() !== null, 3000);
    expect(retry()).not.toBeNull();
  });
});
