import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { uiIdle } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { SessionsHub } = await import("../src/ui/SessionsHub.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

afterEach(cleanup);

type Store = InstanceType<typeof AppStore>;
type State = ReturnType<Store["getState"]>;

const WORDS = {
  en: {
    noHost: "No host yet",
    noOnlineHost: "No host is online",
    add: "Add a host",
    expandAll: "Expand all",
  },
  "pt-BR": {
    noHost: "Nenhum host ainda",
    noOnlineHost: "Nenhum host online",
    add: "Adicionar um host",
    expandAll: "Expandir tudo",
  },
} as const;

const host = (status: "online" | "offline") => ({
  id: "h1",
  name: "h1",
  url: "ws://x",
  token: "",
  status,
  info: null,
  hostInfo: null,
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

const history = [
  {
    claudeSessionId: "c1",
    cwd: "/work/p1",
    projectKey: "host:h1:/work/p1",
    title: "session 1",
    summary: null,
    lastTs: new Date(1_700_000_000_000).toISOString(),
    firstTs: null,
    messageCount: 3,
  },
];

async function mount(lang: "en" | "pt-BR", patch: Partial<State>) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
  await store.i18n.setLang(lang);
  const state = { ...store.getState(), ...patch } as never as State;
  await act(async () => {
    render(
      <TooltipProvider>
        <SessionsHub
          store={store}
          state={state}
          onOpen={() => {}}
          isOpen={() => false}
          density="comfortable"
        />
      </TooltipProvider>,
    );
  });
  await uiIdle();
  return store;
}

for (const lang of ["en", "pt-BR"] as const) {
  const words = WORDS[lang];
  const addButton = () => screen.queryByRole("button", { name: words.add });

  describe(`sessions-no-host (${lang}): the Sessions list never ends in a dead end without a host (#730)`, () => {
    test("with no host it says so and offers Add a host, in place of the fold buttons", async () => {
      await mount(lang, { hosts: [] });
      expect(screen.queryByText(words.noHost)).not.toBeNull();
      expect(addButton()).not.toBeNull();
      expect(screen.queryByRole("button", { name: words.expandAll }) === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    });

    test("the Add a host button opens the Add host flow, the one Home and the sidebar use", async () => {
      const store = await mount(lang, { hosts: [] });
      const before = store.router.current.name;
      expect(addButton()).not.toBeNull();
      await act(async () => {
        fireEvent.click(addButton() as HTMLElement);
      });
      expect([before, store.router.current.name]).toEqual(["home", "add-host"]);
    });

    test("with only an offline host and no session to list it says no host is online and offers Add a host", async () => {
      await mount(lang, { hosts: [host("offline")] as never as State["hosts"], hub: {} });
      expect(screen.queryByText(words.noOnlineHost)).not.toBeNull();
      expect(addButton()).not.toBeNull();
    });

    test("with an online host and sessions the empty state is absent and the list stays", async () => {
      await mount(lang, {
        hosts: [host("online")] as never as State["hosts"],
        hub: { h1: { managed: [], history } } as never as State["hub"],
      });
      expect(screen.queryByText(words.noHost) === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
      expect(screen.queryByText(words.noOnlineHost) === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
      expect(addButton() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
      expect(screen.queryByRole("button", { name: words.expandAll })).not.toBeNull();
    });
  });
}
