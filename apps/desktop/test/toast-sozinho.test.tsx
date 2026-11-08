import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(() => cleanup());

describe("toast-sozinho: a toast with an action or details", () => {
  test("a success with a link shows its action, which runs it", async () => {
    const store = new AppStore(memoryPlatform(false, "en-US").platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    const opened: string[] = [];
    await act(async () => {
      store.success("Card created", { label: "Open", run: () => opened.push("card") });
    });
    const settle = waiter(5000);
    await settle(() => screen.queryByRole("button", { name: "Open" }) !== null);
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Open" }) as HTMLElement);
    });
    expect(opened).toEqual(["card"]);
    store.dispose();
  });

  test("Details shows the host's own message under the translated title, and hides it again", async () => {
    const store = new AppStore(memoryPlatform(false, "en-US").platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.createSession("no-such-host", { cwd: "/", prompt: "hi" });
    });
    const settle = waiter(5000);
    await settle(() => screen.queryAllByRole("alert").length === 1);
    const toast = screen.getAllByRole("alert")[0] as HTMLElement;
    expect(toast.textContent ?? "").not.toContain("unknown host, or no token");
    const details = within(toast).getByRole("button", { name: "Details" });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.click(details);
    });
    await settle(() => (toast.textContent ?? "").includes("unknown host, or no token"));
    expect(details.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      fireEvent.click(details);
    });
    await settle(() => !(toast.textContent ?? "").includes("unknown host, or no token"));
    store.dispose();
  });
});
