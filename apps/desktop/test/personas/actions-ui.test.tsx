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
/** A pack persona the host edited: it can be restored. */
const edited = {
  ...unsigned,
  id: "e",
  name: "Edited",
  scope: "host",
  trusted: true,
  modified: true,
};

type Reply = (type: string, payload: unknown) => unknown | Promise<unknown>;

/** The Personas page of a host whose daemon is a fake: the list is `[unsigned, other, edited]`, `act` answers each action. */
function mount(act1: Reply, language: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  (store as unknown as { update(p: object): void }).update({
    projects: { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "main" }] },
  });
  seedHosts(store, [{ id: "h1", name: "alfa", online: true, features: ["personas"] }]);
  const sent: Array<{ type: string; payload: unknown }> = [];
  let lists = 0;
  store.hostCommand = (async () => {
    lists++;
    return { personas: [unsigned, other, edited] };
  }) as never;
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push({ type, payload });
    return await act1(type, payload);
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <PersonasPage store={store} go={() => {}} />
    </TContext.Provider>,
  );
  return {
    count: (type: string) => sent.filter((s) => s.type === type).length,
    payload: (type: string) => sent.find((s) => s.type === type)?.payload,
    lists: () => lists,
  };
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
      resetFor: "Restore the original of Edited",
      reset: "Restore original",
      publishFor: "Publish Unsigned as a project agent",
      remove: "Remove",
      publish: "Publish",
      editFor: "Edit Unsigned",
      newPersona: "New persona",
      notChanged: "was not changed",
      published: "Published Unsigned at /work/api/.claude/agents/u.md",
    },
  ],
  [
    "pt-BR",
    {
      project: "Projeto",
      trustFor: "Confiar em Unsigned",
      removeFor: "Remover Unsigned",
      resetFor: "Restaurar original de Edited",
      reset: "Restaurar original",
      publishFor: "Publicar Unsigned como agente do projeto",
      remove: "Remover",
      publish: "Publicar",
      editFor: "Editar Unsigned",
      newPersona: "Nova persona",
      notChanged: "não foi alterada",
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

  test("Trust moves the focus to the persona's Edit button before its own turns off", async () => {
    mount(() => new Promise(() => {}), language);
    await settle(() => button(words.trustFor) !== null);
    await press(words.trustFor);
    await settle(() => document.activeElement === button(words.editFor));
  });

  test("a confirmed Remove leaves the focus on a control that stays", async () => {
    mount(() => new Promise(() => {}), language);
    await settle(() => button(words.removeFor) !== null);
    await press(words.removeFor);
    await press(words.remove);
    await settle(() => !has("alertdialog", words.remove));
    await settle(() => document.activeElement === button(words.newPersona));
  });

  test("a refusal says the persona and the host's reason, not that the persona changed", async () => {
    mount(() => refused, language);
    await settle(() => button(words.trustFor) !== null);
    await press(words.trustFor);
    await settle(() => said("alert", "Unsigned"));
    expect(said("alert", words.notChanged)).toBe(false);
  });

  test("a refusal is said on the page with the persona's name and the host's words", async () => {
    mount(() => refused, language);
    await settle(() => button(words.trustFor) !== null);
    await press(words.trustFor);
    await settle(() => said("alert", "Unsigned"));
    expect(said("alert", "No room left")).toBe(true);
    expect(button(words.trustFor)?.disabled).toBe(false);
  });

  test("an action the host accepts sends the persona's hash, reads the list again and shows no error", async () => {
    const page = mount(() => ok, language);
    await settle(() => button(words.trustFor) !== null);
    await press(words.trustFor);
    await settle(() => page.lists() === 2);
    await settle(() => button(words.trustFor)?.disabled === false);
    expect(page.payload("personas.trust")).toEqual({ projectPath: "", id: "u", hash: "h1" });
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  test("a confirmed Reset sends the persona and the language once, and a second press sends nothing", async () => {
    const page = mount(() => new Promise(() => {}), language);
    await settle(() => button(words.resetFor) !== null);
    await press(words.resetFor);
    await press(words.reset);
    await settle(() => button(words.resetFor)?.disabled === true);
    await press(words.resetFor);
    expect(page.count("personas.reset")).toBe(1);
    expect(page.payload("personas.reset")).toEqual({ id: "e", language });
  });

  test("a refused Remove is said on the page with the persona's name", async () => {
    mount(() => refused, language);
    await settle(() => button(words.removeFor) !== null);
    await press(words.removeFor);
    await press(words.remove);
    await settle(() => said("alert", "Unsigned"));
    expect(said("alert", "No room left")).toBe(true);
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
