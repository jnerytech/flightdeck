import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AccountFooter } = await import("../src/components/shell/account-footer.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");
const { WHATS_NEW_KEY } = await import("../src/lib/whats-new.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

async function openMenu() {
  const trigger = screen
    .getAllByRole("button")
    .find((b) => b.getAttribute("data-slot") === "account-trigger") as HTMLElement;
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
  await screen.findByRole("menu");
}

const item = (name: string) => screen.queryByRole("menuitemcheckbox", { name });

async function choose(name: string) {
  await openMenu();
  const found = item(name);
  expect(found).not.toBeNull();
  await act(async () => {
    fireEvent.click(found as HTMLElement);
  });
}

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const labels = {
    badges: dict.sidebarAccount.hideBadges,
    whatsNew: dict.sidebarAccount.hideWhatsNew,
    setup: dict.setup.hide,
  };

  describe(`account-switches (${lang}): hide badges, What's new and the checklist (issue #282)`, () => {
    /** The footer alone, with each switch's state given and each change written down. */
    function footer(state: {
      badges?: boolean;
      whatsNew?: boolean;
      setup?: boolean;
      new?: boolean;
    }) {
      const store = new AppStore(memoryPlatform(false, lang).platform);
      store.i18n.start();
      const calls: string[] = [];
      render(
        <AccountFooter
          account={null}
          hostId={null}
          many={0}
          collapsed={false}
          version="1.2.3"
          density="compact"
          t={store.i18n.t}
          go={() => {}}
          onToggleTheme={() => {}}
          onOpenManual={() => {}}
          onOpen={() => {}}
          githubHosts={[]}
          onSignOutGithub={() => {}}
          onCopy={() => {}}
          onDensity={() => {}}
          hideBadges={state.badges ?? false}
          onHideBadges={(hide) => void calls.push(`badges ${hide}`)}
          hideWhatsNew={state.whatsNew ?? false}
          onHideWhatsNew={(hide) => void calls.push(`whatsNew ${hide}`)}
          hideSetup={state.setup ?? false}
          onHideSetup={(hide) => void calls.push(`setup ${hide}`)}
          onCheckUpdates={() => {}}
          onShortcuts={() => {}}
          hasNew={state.new ?? false}
          onWhatsNew={() => {}}
        />,
      );
      return calls;
    }

    test("three switches show their state, and choosing one asks for the other", async () => {
      const calls = footer({ badges: true });
      await openMenu();
      expect(item(labels.badges)?.getAttribute("aria-checked")).toBe("true");
      expect(item(labels.whatsNew)?.getAttribute("aria-checked")).toBe("false");
      expect(item(labels.setup)?.getAttribute("aria-checked")).toBe("false");
      // The menu is open: pick the first switch from it, then open it again for each of the others.
      await act(async () => {
        fireEvent.click(item(labels.badges) as HTMLElement);
      });
      await choose(labels.whatsNew);
      await choose(labels.setup);
      expect(calls).toEqual(["badges false", "whatsNew true", "setup true"]);
    });

    test("with What's new hidden its entry leaves the menu, and it stays when shown", async () => {
      footer({ whatsNew: true });
      await openMenu();
      const absent =
        screen.queryByRole("menuitem", { name: dict.sidebarAccount.whatsNew }) === null;
      expect(absent).toBe(true);
      cleanup();
      footer({ whatsNew: false });
      await openMenu();
      expect(
        screen.queryByRole("menuitem", { name: new RegExp(dict.sidebarAccount.whatsNew) }),
      ).not.toBeNull();
    });
  });

  describe(`account-switches (${lang}): the sidebar acts on them`, () => {
    /** A sidebar on a version that still wears its badges, with release notes not yet opened. */
    function sidebar() {
      const mem = memoryPlatform(false, lang);
      mem.win.localStorage.setItem(WHATS_NEW_KEY, "0.0.1");
      const store = new AppStore(mem.platform);
      store.i18n.start();
      // A host that has Teams and Conversations, the two items that wear a badge.
      const state = {
        ...store.getState(),
        hosts: [
          {
            id: "h1",
            name: "alfa",
            status: "online",
            hostInfo: { daemonVersion: "x", features: ["teams", "messaging"] },
            sessions: [],
          },
        ],
      } as never as ReturnType<typeof store.getState>;
      render(
        <Sidebar
          store={store}
          state={state}
          collapsed={false}
          t={store.i18n.t}
          go={() => {}}
          appVersion="0.37.0"
          onOpenProjectScreen={() => {}}
          onNewSession={() => {}}
          onRemoveHost={() => {}}
          onRenameHost={() => null}
          onOpenSearch={() => {}}
          onNewTab={() => {}}
          onToggleTheme={() => {}}
        />,
      );
      return store;
    }
    const badges = () => document.querySelectorAll("[data-slot='nav-badge']").length;
    const dot = () => document.querySelector("[data-slot='new-dot']") !== null;
    const setupRowNamed = () =>
      [...document.querySelectorAll("button")].some((b) =>
        (b.getAttribute("aria-label") ?? "").startsWith(dict.setup.title),
      );

    test("Hide badges takes the New and Beta badges off the sidebar, and showing them again brings them back", async () => {
      const store = sidebar();
      expect(badges() > 0).toBe(true);
      await choose(labels.badges);
      expect(store.shellPrefs.value.hideBadges).toBe(true);
      expect(badges()).toBe(0);
      await choose(labels.badges);
      expect(store.shellPrefs.value.hideBadges).toBe(false);
      expect(badges() > 0).toBe(true);
    });

    test("Hide What's new takes the dot off the account row and the entry off the menu", async () => {
      const store = sidebar();
      expect(dot()).toBe(true);
      await choose(labels.whatsNew);
      expect(store.shellPrefs.value.hideWhatsNew).toBe(true);
      expect(dot()).toBe(false);
      await openMenu();
      const absent =
        screen.queryByRole("menuitem", { name: new RegExp(dict.sidebarAccount.whatsNew) }) === null;
      expect(absent).toBe(true);
    });

    test("Hide the setup checklist takes its row off the sidebar, and showing it brings it back", async () => {
      const store = sidebar();
      expect(setupRowNamed()).toBe(true);
      await choose(labels.setup);
      expect(store.setup.hidden).toBe(true);
      expect(setupRowNamed()).toBe(false);
      await choose(labels.setup);
      expect(store.setup.hidden).toBe(false);
      expect(setupRowNamed()).toBe(true);
    });
  });
}
