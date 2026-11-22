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

const unsigned = {
  id: "u",
  name: "Unsigned",
  description: "Not trusted yet",
  scope: "project",
  trusted: false,
  modified: false,
  hash: "h1",
};
const other = { ...unsigned, id: "o", name: "Other", hash: "h2" };

type Reply = (type: string, payload: unknown) => unknown | Promise<unknown>;

/** The Personas page of a host whose daemon is a fake: the list is `[unsigned, other]`, `act` answers each action. */
function mount(act1: Reply, language: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  (store as unknown as { update(p: object): void }).update({
    projects: { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "main" }] },
  });
  seedHosts(store, [{ id: "h1", name: "alfa", online: true, features: ["personas"] }]);
  const sent: string[] = [];
  store.hostCommand = (async () => ({ personas: [unsigned, other] })) as never;
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push(type);
    return await act1(type, payload);
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <PersonasPage store={store} go={() => {}} />
    </TContext.Provider>,
  );
  return { count: (type: string) => sent.filter((s) => s === type).length };
}

const button = (name: string) => screen.queryByRole("button", { name }) as HTMLButtonElement | null;
const has = (role: string, name: string) => screen.queryByRole(role, { name }) !== null;
/** An alert and a status are named by their author, not their content: look at what they say. */
const said = (role: "alert" | "status", text: string) =>
  screen.queryAllByRole(role).some((n) => n.textContent?.includes(text));
const press = async (name: string) => {
  const target = button(name);
  expect(target).not.toBeNull();
  await act(async () => {
    fireEvent.click(target as HTMLElement);
  });
};
const chooseProject = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
};

const ok = { ok: true, data: {} };
const refused = { ok: false, code: "bad_thing", message: "No room left" };

// Issue #168: Trust, Reset, Remove and Publish are busy while the host answers, say it on the page when
// the host refuses, and the publish line names the persona and clears when the person moves on.
describe.each([
  [
    "en",
    {
      project: "Project",
      trustFor: "Trust Unsigned",
      removeFor: "Remove Unsigned",
      publishFor: "Publish Unsigned as a project agent",
      remove: "Remove",
      publish: "Publish",
      published: "Published Unsigned at /work/api/.claude/agents/u.md",
    },
  ],
  [
    "pt-BR",
    {
      project: "Projeto",
      trustFor: "Confiar em Unsigned",
      removeFor: "Remover Unsigned",
      publishFor: "Publicar Unsigned como agente do projeto",
      remove: "Remover",
      publish: "Publicar",
      published: "Unsigned publicada em /work/api/.claude/agents/u.md",
    },
  ],
] as const)("personas actions (%s)", (language, words) => {
  test("Trust is busy until the host answers and a second press sends nothing", async () => {
    const page = mount(() => new Promise(() => {}), language);
    await settle(() => button(words.trustFor) !== null);
    await press(words.trustFor);
    await settle(() => button(words.trustFor)?.getAttribute("aria-busy") === "true");
    await press(words.trustFor);
    expect(page.count("personas.trust")).toBe(1);
  });

  test("a confirmed Remove leaves the row's actions busy and sends once", async () => {
    const page = mount(() => new Promise(() => {}), language);
    await settle(() => button(words.removeFor) !== null);
    await press(words.removeFor);
    await press(words.remove);
    await settle(() => button(words.removeFor)?.disabled === true);
    await press(words.removeFor);
    expect(page.count("personas.remove")).toBe(1);
    expect(has("alertdialog", words.remove)).toBe(false);
  });

  test("a refusal is said on the page with the persona's name and the host's words", async () => {
    mount(() => refused, language);
    await settle(() => button(words.trustFor) !== null);
    await press(words.trustFor);
    await settle(() => said("alert", "Unsigned"));
    expect(said("alert", "No room left")).toBe(true);
    expect(button(words.trustFor)?.disabled).toBe(false);
  });

  test("an action the host accepts shows no error", async () => {
    mount(() => ok, language);
    await settle(() => button(words.trustFor) !== null);
    await press(words.trustFor);
    await settle(() => button(words.trustFor)?.disabled === false);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  test("a publish says which persona went where, and the line clears when the project changes", async () => {
    mount(() => ({ ok: true, data: { path: "/work/api/.claude/agents/u.md" } }), language);
    await chooseProject(words.project, "/work/api");
    await settle(() => button(words.publishFor) !== null);
    await press(words.publishFor);
    await press(words.publish);
    await settle(() => said("status", words.published));
    await chooseProject(words.project, "");
    await settle(() => !said("status", words.published));
  });

  test("the publish line clears when another action starts", async () => {
    mount(
      (type) => (type === "personas.publishAgent" ? { ok: true, data: { path: "/x/u.md" } } : ok),
      language,
    );
    await chooseProject(words.project, "/work/api");
    await settle(() => button(words.publishFor) !== null);
    await press(words.publishFor);
    await press(words.publish);
    await settle(() => said("status", "/x/u.md"));
    await press(words.trustFor);
    await settle(() => !said("status", "/x/u.md"));
  });
});
