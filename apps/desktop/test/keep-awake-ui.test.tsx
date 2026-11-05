import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

async function hostPage(
  language: "en" | "pt-BR",
  keepAwake?: { held?: boolean; reason?: "no-inhibitor" | "start-failed" },
) {
  const d = makeDaemon(cleanups, keepAwake ? { keepAwake } : {});
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  await act(async () => store.router.push({ name: "host", host: hostId }));
  return store;
}

const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("keep-awake-ui: the host page's switch (#163)", () => {
  test("it says what it does, whether it is on, and turns off and on again", async () => {
    const store = await hostPage("en", {});
    await settle(() => screen.queryByText("Keep this computer awake") !== null);
    expect(screen.queryByText(/screen may still turn off/)).not.toBeNull();
    expect(
      screen.queryByText("On: the computer stays awake only while sessions run."),
    ).not.toBeNull();
    await press("Turn off");
    await settle(() => store.getState().hosts[0]?.hostInfo?.keepAwake?.enabled === false);
    await settle(() => screen.queryByText("Off: the computer sleeps as the system says.") !== null);
    await press("Turn on");
    await settle(() => store.getState().hosts[0]?.hostInfo?.keepAwake?.enabled === true);
  });

  test("while it holds, the page says so", async () => {
    await hostPage("en", { held: true });
    await settle(() => screen.queryByText("Holding the computer awake now.") !== null);
  });

  test("when nothing can hold it, the reason is said in words", async () => {
    await hostPage("en", { reason: "no-inhibitor" });
    await settle(
      () =>
        screen.queryByText(
          "Nothing on this computer can hold it awake (no systemd-inhibit, caffeinate or PowerShell).",
        ) !== null,
    );
  });

  test("in Portuguese too", async () => {
    await hostPage("pt-BR", {});
    await settle(() => screen.queryByText("Manter este computador acordado") !== null);
    expect(
      screen.queryByText("Ligado: o computador fica acordado só enquanto há sessões."),
    ).not.toBeNull();
  });

  test("a host that does not announce it shows no switch", async () => {
    await hostPage("en");
    await settle(() => screen.queryByText("Sessions without permission prompts") !== null);
    expect(screen.queryByText("Keep this computer awake")).toBeNull();
  });
});
