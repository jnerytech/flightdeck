import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { personasHost } from "./personas-ui-setup.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function open() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await personasHost(cleanups, store);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Personas" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Personas" }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("list", { name: "Personas" }) !== null);
  return { store, ...h };
}

async function click(name: string) {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(150));
}

async function fill(label: string, value: string) {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
  await act(() => Bun.sleep(40));
}

const preview = () => screen.queryByRole("region", { name: "Prévia" })?.textContent ?? "";

async function newPersona() {
  await click("Nova persona");
  await fill("Id", "meu-qa");
  await fill("Nome", "Meu QA");
  await fill("Descrição", "Testes antes de tudo");
  await fill("Instruções", "Escreva o teste antes do código.");
}

describe("personas-ui: the editor", () => {
  test("the preview says what a session gets: the appended text, model, effort, the tools it restricts and the mode it caps", async () => {
    await open();
    await newPersona();
    expect(preview()).toContain("Escreva o teste antes do código.");
    expect(preview()).toContain("Ferramentas: as da sessão");
    await fill("Modelo", "claude-sonnet-5-5");
    await fill("Esforço", "high");
    await fill("Ferramentas (separadas por vírgula)", "Read, Grep");
    await fill("Modo de permissão sugerido", "plan");
    expect(preview()).toContain("claude-sonnet-5-5");
    expect(preview()).toContain("high");
    expect(preview()).toContain("Ferramentas: só Read, Grep, e nenhuma que a sessão não tenha");
    expect(preview()).toContain("Modo: plan, se for mais restrito que o da sessão");
  });

  test("a new persona goes to the host, with what was typed", async () => {
    const { store, hostId } = await open();
    await newPersona();
    await fill("Ferramentas (separadas por vírgula)", "Read, Grep");
    await click("Salvar persona");
    const listed = await store.hostCommand(hostId, "personas.list", {
      scope: "host",
      language: "pt-BR",
    });
    expect(listed?.personas.find((p) => p.id === "meu-qa")).toMatchObject({
      name: "Meu QA",
      scope: "host",
      tools: ["Read", "Grep"],
      body: "Escreva o teste antes do código.",
    });
  });

  test("or to the app, as a global one", async () => {
    const { store } = await open();
    await newPersona();
    await fill("Onde guardar", "app");
    await click("Salvar persona");
    expect(store.globalPersonas.list().map((p) => p.id)).toEqual(["meu-qa"]);
  });

  test("or to the project's versioned folder, when a project is chosen", async () => {
    const { repo } = await open();
    await fill("Projeto", repo);
    await newPersona();
    await fill("Onde guardar", "project");
    await click("Salvar persona");
    await settle(() => existsSync(join(repo, ".flightdeck", "personas", "meu-qa.md")));
    expect(existsSync(join(repo, ".flightdeck", "personas", "meu-qa.md"))).toBe(true);
  });

  test("a secret in the instructions is refused with the reason", async () => {
    const { store, hostId } = await open();
    await newPersona();
    await fill("Instruções", "Use o token ghp_abcdefghijklmnopqrstuvwxyz0123456789 no deploy.");
    await click("Salvar persona");
    expect(screen.queryByRole("alert")?.textContent).toContain("A persona tem um segredo");
    // What was typed stays in the field; nothing was kept on the host.
    const listed = await store.hostCommand(hostId, "personas.list", {
      scope: "host",
      language: "pt-BR",
    });
    expect(listed?.personas.some((p) => p.id === "meu-qa")).toBe(false);
  });

  test("Editar a pack persona saves the host's version of it, with the id kept", async () => {
    const { store, hostId } = await open();
    await click("Editar QA / testes");
    expect((screen.queryByLabelText("Id") as HTMLInputElement | null)?.disabled).toBe(true);
    await fill("Nome", "QA do host");
    await click("Salvar persona");
    const listed = await store.hostCommand(hostId, "personas.list", {
      scope: "host",
      language: "pt-BR",
    });
    expect(listed?.personas.find((p) => p.id === "qa")).toMatchObject({
      name: "QA do host",
      modified: true,
    });
  });

  test("a secret in a persona kept in the app is refused the same way, and the app keeps nothing", async () => {
    const { store } = await open();
    await newPersona();
    await fill("Onde guardar", "app");
    await fill("Instruções", "Use o token ghp_abcdefghijklmnopqrstuvwxyz0123456789 no deploy.");
    await click("Salvar persona");
    expect(screen.queryByRole("alert")?.textContent).toContain("A persona tem um segredo");
    expect(store.globalPersonas.list()).toEqual([]);
  });

  test("the icon typed is kept with the persona", async () => {
    const { store } = await open();
    await newPersona();
    await fill("Ícone", "flask");
    await fill("Onde guardar", "app");
    await click("Salvar persona");
    expect(store.globalPersonas.list()[0]?.icon).toBe("flask");
  });
});
