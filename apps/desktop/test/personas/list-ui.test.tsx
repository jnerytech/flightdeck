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
function mount(
  reply: Reply,
  language: "en" | "pt-BR",
  online = true,
  go: (route: unknown) => void = () => {},
) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  (store as unknown as { update(p: object): void }).update({
    projects: { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "main" }] },
  });
  seedHosts(store, [{ id: "h1", name: "alfa", online, features: ["personas"] }]);
  const sent: string[] = [];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push(type);
    return await reply(type, payload);
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <PersonasPage store={store} go={go} />
    </TContext.Provider>,
  );
  return { count: (type: string) => sent.filter((s) => s === type).length };
}

const has = (role: string, name: string | RegExp) => screen.queryByRole(role, { name }) !== null;
/** An alert is named by its author, not its content: look at what it says. */
const alerted = (text: string) => screen.queryByRole("alert")?.textContent?.includes(text) === true;
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
      noHost: "No connected host with personas",
      addHost: "Add a host",
      project: "Project",
      add: "New persona",
      edit: "Edit QA",
      cancel: "Cancel",
      locked: "Finish or cancel the open editor to change the project.",
      untrusted: "Not trusted",
    },
  ],
  [
    "pt-BR",
    {
      loading: "Carregando personas",
      failed: "Não foi possível ler as personas deste host.",
      retry: "Tentar de novo",
      empty: "Nenhuma persona.",
      noHost: "Nenhum host conectado com personas",
      addHost: "Adicionar host",
      project: "Projeto",
      add: "Nova persona",
      edit: "Editar QA",
      cancel: "Cancelar",
      locked: "Termine ou cancele o editor aberto para mudar o projeto.",
      untrusted: "Não confiável",
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

  test("with no host online there is nothing to wait for: the page names the missing host and the project choice is off", async () => {
    mount(() => new Promise(() => {}), language, false);
    // The page has settled once it says either of the two things; only the first is the right one.
    await settle(() => hasText(words.noHost) || hasText(words.empty));
    expect(hasText(words.noHost)).toBe(true);
    expect(has("status", words.loading)).toBe(false);
    expect(hasText(words.empty)).toBe(false);
    expect(screen.queryByLabelText(words.project)).toBeNull();
  });

  test("with no host online, the page's link goes to Add host", async () => {
    const routes: unknown[] = [];
    mount(
      () => new Promise(() => {}),
      language,
      false,
      (route) => routes.push(route),
    );
    await settle(() => hasText(words.noHost) || hasText(words.empty));
    await press(words.addHost);
    expect(routes).toEqual([{ name: "add-host" }]);
  });

  // #4215: axe failed the badge's contrast in the light theme: text-destructive on its own tint is under 4.5:1.
  test("the not-trusted badge uses the error text colour that meets contrast, not the destructive one", async () => {
    mount(() => ({ personas: [{ ...qa, trusted: false }] }), language);
    await settle(() => hasText(words.untrusted));
    const classes = screen.getByText(words.untrusted).className.split(" ");
    expect([classes.includes("text-status-error"), classes.includes("text-destructive")]).toEqual([
      true,
      false,
    ]);
  });

  test("another project's read in flight does not show the last project's cards", async () => {
    mount(
      (_type, payload) =>
        (payload as { scope: string }).scope === "host"
          ? { personas: [qa] }
          : new Promise(() => {}),
      language,
    );
    await settle(() => hasText("QA"));
    await act(async () => {
      fireEvent.change(screen.getByLabelText(words.project), { target: { value: "/work/api" } });
    });
    await settle(() => has("status", words.loading));
    expect(hasText("QA")).toBe(false);
  });

  test("the retry after a failed refresh is loading again, not the old cards", async () => {
    let calls = 0;
    mount(
      () => (++calls === 1 ? { personas: [qa] } : calls === 2 ? null : new Promise(() => {})),
      language,
    );
    await settle(() => hasText("QA"));
    // The page reads again once the person changes language-independent state: a project round trip.
    await act(async () => {
      fireEvent.change(screen.getByLabelText(words.project), { target: { value: "@app" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(words.project), { target: { value: "" } });
    });
    await settle(() => alerted(words.failed));
    await press(words.retry);
    await settle(() => has("status", words.loading));
    expect(hasText("QA")).toBe(false);
  });

  test("a refused read says so with a retry, and no empty state", async () => {
    mount(() => null, language);
    await settle(() => alerted(words.failed));
    expect(has("button", words.retry)).toBe(true);
    expect(hasText(words.empty)).toBe(false);
    expect(has("status", words.loading)).toBe(false);
  });

  test("the retry reads again and shows what the host answers", async () => {
    let answer: unknown = null;
    const page = mount(() => answer, language);
    await settle(() => alerted(words.failed));
    answer = { personas: [qa] };
    await press(words.retry);
    await settle(() => hasText("QA"));
    expect(alerted(words.failed)).toBe(false);
    expect(page.count("personas.list")).toBe(2);
  });

  test("while an editor is open the project cannot change under it, and says why", async () => {
    mount(() => ({ personas: [qa] }), language);
    await settle(() => hasText("QA"));
    const select = () => screen.getByLabelText(words.project) as HTMLSelectElement;
    expect([select().disabled, hasText(words.locked)]).toEqual([false, false]);
    await press(words.add);
    expect([select().disabled, hasText(words.locked)]).toEqual([true, true]);
    await press(words.cancel);
    expect([select().disabled, hasText(words.locked)]).toEqual([false, false]);
    // The editor of a persona already in the list is the one that would lose its text.
    await press(words.edit);
    expect([select().disabled, hasText(words.locked)]).toEqual([true, true]);
  });
});
