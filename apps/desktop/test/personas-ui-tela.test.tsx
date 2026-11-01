import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { personasHost } from "./personas-ui-setup.ts";

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

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

async function open(
  seed?: (
    store: InstanceType<typeof AppStore>,
    h: Awaited<ReturnType<typeof personasHost>>,
  ) => Promise<void> | void,
) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await personasHost(cleanups, store);
  await seed?.(store, h);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Personas" }) !== null);
  const nav = screen.queryByRole("button", { name: "Personas" });
  expect(nav).not.toBeNull();
  await act(async () => {
    fireEvent.click(nav as HTMLElement);
  });
  await settle(() => rows().length > 0, 3000);
  return { store, ...h };
}

const rows = () => {
  const list = screen.queryByRole("list", { name: "Personas" });
  return list ? within(list).queryAllByRole("listitem") : [];
};
const row = (name: string) =>
  rows().find((r) => r.querySelector("[data-name]")?.textContent === name);
const names = () => rows().map((r) => r.querySelector("[data-name]")?.textContent ?? "");

async function click(name: string) {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(150));
}

async function choose(label: string, value: string) {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
  await act(() => Bun.sleep(150));
}

describe("personas-ui: the library", () => {
  test("the sidebar's Personas opens the library with the ten of the pack, in the app's language", async () => {
    await open();
    expect(screen.queryByRole("heading", { name: "Personas", level: 1 })).not.toBeNull();
    expect(names()).toHaveLength(10);
    expect(names()).toContain("Revisor de segurança");
    expect(within(row("Revisor de segurança") as HTMLElement).queryByText("Pacote")).not.toBeNull();
  });

  test("with a project chosen, its versioned personas show too, untrusted until Confiar", async () => {
    const { repo } = await open((_s, h) => {
      h.writePersona("nosso-qa", "QA do time", "Teste tudo.");
    });
    await choose("Projeto", repo);
    const ours = row("QA do time");
    expect(ours).toBeDefined();
    expect(within(ours as HTMLElement).queryByText("Projeto")).not.toBeNull();
    expect(within(ours as HTMLElement).queryByText("Não confiável")).not.toBeNull();
    await click("Confiar em QA do time");
    expect(within(row("QA do time") as HTMLElement).queryByText("Não confiável")).toBeNull();
  });

  test("Globais shows the app's own personas", async () => {
    await open((store) => {
      store.globalPersonas.save({
        id: "meu",
        name: "Minha persona",
        description: "Do app",
        body: "Seja breve.",
      });
    });
    await choose("Projeto", "@app");
    expect(names()).toEqual(["Minha persona"]);
    expect(within(row("Minha persona") as HTMLElement).queryByText("App")).not.toBeNull();
  });

  test("a host persona is removed after a confirmation", async () => {
    await open(async (store, h) => {
      await store.hostCommand(h.hostId, "personas.save", {
        scope: "host",
        persona: { id: "do-host", name: "Do host", description: "Minha", body: "Oi." },
      });
    });
    expect(names()).toContain("Do host");
    await click("Remover Do host");
    await click("Remover");
    expect(names()).not.toContain("Do host");
  });

  test("an edited pack persona can be restored to the original", async () => {
    await open(async (store, h) => {
      await store.hostCommand(h.hostId, "personas.save", {
        scope: "host",
        persona: { id: "qa", name: "QA editado", description: "Mudei", body: "Outro texto." },
      });
    });
    expect(within(row("QA editado") as HTMLElement).queryByText("Pacote, editada")).not.toBeNull();
    await click("Restaurar original de QA editado");
    // The confirmation comes first: Cancelar keeps the edits.
    await click("Cancelar");
    expect(names()).toContain("QA editado");
    await click("Restaurar original de QA editado");
    await click("Restaurar original");
    expect(names()).not.toContain("QA editado");
    expect(names()).toHaveLength(10);
  });

  test("Publicar como agente do projeto writes .claude/agents/persona-<id>.md after a confirmation", async () => {
    const { repo } = await open();
    await choose("Projeto", repo);
    await click("Publicar Revisor de segurança como agente do projeto");
    expect(existsSync(join(repo, ".claude", "agents", "persona-seguranca.md"))).toBe(false);
    await click("Publicar");
    await settle(() => existsSync(join(repo, ".claude", "agents", "persona-seguranca.md")));
    expect(existsSync(join(repo, ".claude", "agents", "persona-seguranca.md"))).toBe(true);
  });

  test("Cancelar keeps everything: the removal, the publication and the editor", async () => {
    const { repo } = await open(async (store, h) => {
      await store.hostCommand(h.hostId, "personas.save", {
        scope: "host",
        persona: { id: "do-host", name: "Do host", description: "Minha", body: "Oi." },
      });
    });
    await click("Remover Do host");
    await click("Cancelar");
    expect(names()).toContain("Do host");
    await choose("Projeto", repo);
    await click("Publicar Revisor de segurança como agente do projeto");
    await click("Cancelar");
    expect(existsSync(join(repo, ".claude", "agents", "persona-seguranca.md"))).toBe(false);
    await click("Nova persona");
    expect(screen.queryByRole("button", { name: "Salvar persona" })).not.toBeNull();
    await click("Cancelar");
    expect(screen.queryByRole("button", { name: "Salvar persona" })).toBeNull();
  });
});
