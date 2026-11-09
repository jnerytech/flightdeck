import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { CardRunForm } = await import("../src/components/card/card-run-form.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const finished = {
  id: "c1",
  projectId: "p1",
  title: "Cart screen",
  description: "",
  column: "review",
  validationNote: null,
  prUrl: null,
  prState: null,
  queued: false,
  sessionId: "s1",
  sessionStatus: "ended",
  worktreePath: "/w",
  branch: "card/cart-screen",
};

function setup(provider: string | null, language: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  if (provider !== null)
    (store as unknown as { update(p: object): void }).update({
      projects: { h1: [{ id: "p1", name: "shop", prProvider: provider }] },
    });
  const commands: string[] = [];
  store.hostCommand = (async (_host: string, type: string) => {
    commands.push(type);
    return {};
  }) as never;
  store.describePr = (async () => {
    commands.push("describePr");
    return { text: "text", redacted: 0 };
  }) as never;
  const seen = { shown: 0 };
  const form = (tab: "conversation" | "diff") => (
    <TContext.Provider value={store.i18n.t}>
      <CardRunForm
        store={store}
        hostId="h1"
        card={finished as never}
        features={{ bg: true, watch: true }}
        tab={tab}
        canMerge={false}
        gateWaiting={false}
        onMerge={() => {}}
        arenaStart={null}
        onDiscarded={() => {}}
        onShowDiff={() => {
          seen.shown++;
        }}
      />
    </TContext.Provider>
  );
  return { store, commands, seen, form };
}

const button = (name: string | RegExp) => screen.queryByRole("button", { name });
async function openMenu() {
  const trigger = button("Actions for Cart screen") ?? button("Ações de Cart screen");
  expect(trigger !== null).toBe(true);
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
}
const panel = () => document.querySelector('[data-slot="card-run"]')?.textContent ?? "";

describe("card-no-remote-ui: Open PR on a project that has no PR provider (#1543)", () => {
  test("on the changes, there is no Open PR button: the panel says why and where the work is, before any form", async () => {
    const w = setup("none");
    render(w.form("diff"));
    expect(button("Open PR") === null).toBe(true);
    expect(panel()).toContain("no GitHub or Azure DevOps remote");
    expect(panel()).toContain("git remote add origin");
    expect(panel()).toContain("gh auth login");
    expect(panel()).toContain("card/cart-screen");
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Open PR" }) === null).toBe(true);
    // Nothing was asked of the host: no description, no form.
    expect(w.commands).toEqual([]);
  });

  test("the card's changes stay reachable: Review changes leads from the conversation", async () => {
    const w = setup("none");
    render(w.form("conversation"));
    expect(button("Review changes") !== null).toBe(true);
    expect(button("Open PR") === null).toBe(true);
    expect(panel()).toContain("no GitHub or Azure DevOps remote");
    await act(async () => {
      fireEvent.click(button("Review changes") as HTMLElement);
    });
    expect(w.seen.shown).toBe(1);
  });

  test("the same in Portuguese", () => {
    const w = setup("none", "pt-BR");
    render(w.form("diff"));
    expect(button("Abrir PR") === null).toBe(true);
    expect(panel()).toContain("não tem remote do GitHub nem do Azure DevOps");
    expect(panel()).toContain("card/cart-screen");
  });

  test("a project with a provider keeps Open PR, and says nothing about a remote", async () => {
    const w = setup("github");
    render(w.form("diff"));
    expect(button("Open PR") !== null).toBe(true);
    expect(panel()).not.toContain("remote");
    await act(async () => {
      fireEvent.click(button("Open PR") as HTMLElement);
    });
    expect(w.commands).toContain("describePr");
  });

  test("a project the app has not loaded yet is not judged: Open PR stays, and the host still decides", () => {
    const w = setup(null);
    render(w.form("diff"));
    expect(button("Open PR") !== null).toBe(true);
    expect(panel()).not.toContain("remote");
  });
});
