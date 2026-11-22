import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, seedHosts } from "../fixtures.ts";
import { waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { PersonasPage } = await import("../../src/features/personas/page.tsx");

setDefaultTimeout(20_000);
afterEach(cleanup);
const settle = waiter(1500);

const qa = {
  id: "qa",
  name: "QA",
  description: "Writes the failing test first",
  scope: "host",
  trusted: true,
  modified: false,
};

type Reply = (type: string, payload: unknown) => unknown | Promise<unknown>;

/** The Personas page of a host whose daemon is a fake: `reply` answers each request, null is a refusal. */
function mount(reply: Reply, language: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  seedHosts(store, [{ id: "h1", name: "alfa", features: ["personas"] }]);
  const sent: string[] = [];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push(type);
    return await reply(type, payload);
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <PersonasPage store={store} go={() => {}} />
    </TContext.Provider>,
  );
  return { count: (type: string) => sent.filter((s) => s === type).length };
}

const has = (role: string, name: string | RegExp) =>
  screen.queryByRole(role, { name }) !== null;
const hasText = (text: string) => screen.queryByText(text) !== null;

const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

// Issue #168: the list of personas says it is loading, says it could not be read, and shows the empty
// state only once the host has answered that there is none.
describe.each([
  [
    "en",
    {
      loading: "Loading personas",
      failed: "Could not read this host's personas.",
      retry: "Try again",
      empty: "No persona.",
    },
  ],
  [
    "pt-BR",
    {
      loading: "Carregando personas",
      failed: "Não foi possível ler as personas deste host.",
      retry: "Tentar de novo",
      empty: "Nenhuma persona.",
    },
  ],
] as const)("personas list (%s)", (language, words) => {
  test("while the host has not answered, it is loading and not empty", async () => {
    mount(() => new Promise(() => {}), language);
    await settle(() => has("status", words.loading));
    expect(hasText(words.empty)).toBe(false);
  });

  test("a host that answers with none shows the empty state", async () => {
    mount(() => ({ personas: [] }), language);
    await settle(() => hasText(words.empty));
    expect(has("status", words.loading)).toBe(false);
  });

  test("a refused read says so with a retry, and no empty state", async () => {
    mount(() => null, language);
    await settle(() => has("alert", words.failed));
    expect(has("button", words.retry)).toBe(true);
    expect(hasText(words.empty)).toBe(false);
    expect(has("status", words.loading)).toBe(false);
  });

  test("the retry reads again and shows what the host answers", async () => {
    let answer: unknown = null;
    const page = mount(() => answer, language);
    await settle(() => has("alert", words.failed));
    answer = { personas: [qa] };
    await press(words.retry);
    await settle(() => hasText("QA"));
    expect(has("alert", words.failed)).toBe(false);
    expect(page.count("personas.list")).toBe(2);
  });
});
