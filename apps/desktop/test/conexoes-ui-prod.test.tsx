import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";
import { fakeXterm } from "./terminal-fakes.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TerminalPage } = await import("../src/ui/TerminalPage.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A terminal screen; `ssh` says it was opened from a ssh destino with those tags. */
async function setup(ssh?: { name: string; tags: string[] }) {
  const d = makeDaemon(cleanups, { terminals: true });
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
  const { terminalId } = await store.terminalHost(hostId).open(d.project, 80, 24);
  if (ssh) store.sshTerminals.set(`${hostId}/${terminalId}`, ssh);
  render(
    <TContext.Provider value={store.i18n.t}>
      <TerminalPage
        store={store}
        hostId={hostId}
        terminalId={terminalId}
        deps={fakeXterm().deps}
        onClosed={() => {}}
      />
    </TContext.Provider>,
  );
}

const marked = () => screen.queryByTestId("ssh-terminal");

describe("conexoes-ui: the SSH terminal", () => {
  test("a terminal opened from a destino carries a badge with its name and its tags", async () => {
    await setup({ name: "vps", tags: ["staging", "cliente X"] });
    expect(screen.queryByText("SSH · vps")).not.toBeNull();
    expect(screen.queryByText("staging")).not.toBeNull();
    expect(screen.queryByText("cliente X")).not.toBeNull();
  });

  test("the prod and produção tags give the screen a red border", async () => {
    await setup({ name: "vps", tags: ["prod"] });
    expect(marked()?.getAttribute("data-prod")).toBe("true");
    expect(marked()?.className).toContain("border-destructive");
    cleanup();
    await setup({ name: "vps", tags: ["Produção"] });
    expect(marked()?.getAttribute("data-prod")).toBe("true");
  });

  test("another tag leaves the border alone", async () => {
    await setup({ name: "lab", tags: ["staging"] });
    expect(marked()?.getAttribute("data-prod")).toBe("false");
    expect(marked()?.className).not.toContain("border-destructive");
  });

  test("a terminal that did not come from a destino has no badge and no mark", async () => {
    await setup();
    expect(screen.queryByText(/^SSH · /)).toBeNull();
    expect(marked()).toBeNull();
  });
});
