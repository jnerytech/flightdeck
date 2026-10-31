import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { memoriaHost } from "./memoria-ui-setup.ts";

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

const INDEX = "- [Papel](user_role.md) — quem é o usuário\n";
const ROLE = "---\nname: papel\ndescription: quem é o usuário\ntype: user\n---\nÉ engenheiro.\n";

/** The Agente screen of the project, on its Memória tab, over memory the test wrote first. */
async function open(seed: (put: (name: string, text: string) => void) => void = () => {}) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await memoriaHost(cleanups, store);
  seed(h.put);
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("memory") === true);
  await act(async () => {
    store.router.push({
      name: "agent",
      host: h.hostId,
      projectId: h.projectId,
      projectName: "repo",
    });
  });
  await settle(() => screen.queryByRole("tab", { name: "Memória" }) !== null);
  const tab = screen.queryByRole("tab", { name: "Memória" });
  if (tab) {
    await act(async () => {
      fireEvent.mouseDown(tab, { button: 0 });
    });
  }
  return { store, ...h };
}

async function click(name: string | RegExp, role = "button") {
  const element = screen.queryByRole(role, { name });
  expect(element).not.toBeNull();
  await act(async () => {
    fireEvent.click(element as HTMLElement);
  });
  await act(() => Bun.sleep(120));
}

async function fill(label: string, value: string) {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
}

const names = () =>
  [...(screen.queryByRole("list", { name: "Memórias" })?.querySelectorAll("li") ?? [])].map(
    (li) => li.querySelector("[data-name]")?.textContent ?? "",
  );

describe("memoria-ui: a memória do projeto", () => {
  test("a aba Memória lista os arquivos da pasta, com o tipo e o aviso do que o índice não cita", async () => {
    await open((put) => {
      put("MEMORY.md", INDEX);
      put("user_role.md", ROLE);
      put("solta.md", "sem frontmatter\n");
    });
    await settle(() => names().length === 3);
    expect(names()).toEqual(["MEMORY.md", "solta.md", "user_role.md"]);
    const solta = screen.queryByRole("button", { name: "Abrir solta.md" })?.closest("li");
    expect(within(solta as HTMLElement).queryByText("Fora do índice")).not.toBeNull();
    const role = screen.queryByRole("button", { name: "Abrir user_role.md" })?.closest("li");
    expect(within(role as HTMLElement).queryByText("user")).not.toBeNull();
    expect(within(role as HTMLElement).queryByText("Fora do índice")).toBeNull();
  });

  test("sem pasta de memória, a aba diz que ainda não há memória", async () => {
    await open();
    await settle(() => screen.queryByText("Ainda não há memória neste projeto.") !== null);
    expect(screen.queryByText("Ainda não há memória neste projeto.")).not.toBeNull();
  });

  test("editar pede confirmação antes de gravar; cancelar não grava; confirmar grava com o hash e avisa", async () => {
    const { dir } = await open((put) => {
      put("MEMORY.md", INDEX);
      put("user_role.md", ROLE);
    });
    await settle(() => names().length === 2);
    await click("Abrir user_role.md");
    await fill("Conteúdo de user_role.md", `${ROLE}Mais uma linha.\n`);
    await click("Salvar");
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    await click("Cancelar");
    expect(readFileSync(join(dir, "user_role.md"), "utf8")).toBe(ROLE);
    await click("Salvar");
    await click("Salvar na memória", "button");
    await settle(() => readFileSync(join(dir, "user_role.md"), "utf8") !== ROLE);
    expect(readFileSync(join(dir, "user_role.md"), "utf8")).toBe(`${ROLE}Mais uma linha.\n`);
    await settle(() => screen.queryByText("Memória salva.") !== null);
    expect(screen.queryByText("Memória salva.")).not.toBeNull();
  });

  test("se o arquivo mudou no disco depois de aberto, a gravação é recusada, o texto fica e há como recarregar", async () => {
    const { dir, put } = await open((p) => {
      p("MEMORY.md", INDEX);
      p("user_role.md", ROLE);
    });
    await settle(() => names().length === 2);
    await click("Abrir user_role.md");
    put("user_role.md", `${ROLE}Mudou por fora.\n`);
    await fill("Conteúdo de user_role.md", `${ROLE}Minha edição.\n`);
    await click("Salvar");
    await click("Salvar na memória", "button");
    await settle(() => screen.queryByRole("button", { name: "Recarregar" }) !== null);
    expect(screen.queryByRole("button", { name: "Recarregar" })).not.toBeNull();
    expect(readFileSync(join(dir, "user_role.md"), "utf8")).toBe(`${ROLE}Mudou por fora.\n`);
    expect((screen.queryByLabelText("Conteúdo de user_role.md") as HTMLTextAreaElement).value).toBe(
      `${ROLE}Minha edição.\n`,
    );
    await click("Recarregar");
    expect((screen.queryByLabelText("Conteúdo de user_role.md") as HTMLTextAreaElement).value).toBe(
      `${ROLE}Mudou por fora.\n`,
    );
  });

  test("Nova memória cria um arquivo .md simples, depois da confirmação, e nome inválido não deixa criar", async () => {
    const { dir } = await open((put) => put("MEMORY.md", INDEX));
    await settle(() => names().length === 1);
    await click("Nova memória");
    await fill("Nome do arquivo", "../fora");
    expect((screen.queryByRole("button", { name: "Criar" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await fill("Nome do arquivo", "feedback_testes");
    await click("Criar");
    await fill("Conteúdo de feedback_testes.md", "Teste primeiro.\n");
    await click("Salvar");
    await click("Salvar na memória", "button");
    await settle(() => existsSync(join(dir, "feedback_testes.md")));
    expect(readFileSync(join(dir, "feedback_testes.md"), "utf8")).toBe("Teste primeiro.\n");
    await settle(() => names().includes("feedback_testes.md"));
    expect(names()).toContain("feedback_testes.md");
  });

  test("Apagar pede confirmação e remove o arquivo", async () => {
    const { dir } = await open((put) => {
      put("MEMORY.md", INDEX);
      put("velha.md", "velha\n");
    });
    await settle(() => names().length === 2);
    await click("Apagar velha.md");
    await click("Cancelar");
    expect(existsSync(join(dir, "velha.md"))).toBe(true);
    await click("Apagar velha.md");
    await click("Apagar", "button");
    await settle(() => !existsSync(join(dir, "velha.md")));
    expect(existsSync(join(dir, "velha.md"))).toBe(false);
    await settle(() => !names().includes("velha.md"));
    expect(names()).not.toContain("velha.md");
  });
});

describe("memoria-ui: sugestões de limpeza", () => {
  test("aponta duplicadas, links quebrados, soltas, antigas e contradições, e não muda nada sozinha", async () => {
    const { dir } = await open((put) => {
      put("MEMORY.md", "- [A](a.md)\n- [B](b.md)\n- [Some](sumiu.md)\n- [C](c.md)\n- [D](d.md)\n");
      const fm = (d: string) =>
        `---\nname: n\ndescription: ${d}\ntype: feedback\n---\ncorpo ${d}\n`;
      put("a.md", fm("always run the tests before commit"));
      put("b.md", fm("never run the tests before commit"));
      put("c.md", "---\nname: n\ndescription: igual\ntype: user\n---\nigual\n");
      put("d.md", "---\nname: n\ndescription: igual\ntype: user\n---\nigual\n");
      put("solta.md", "solta\n");
    });
    const region = () => screen.queryByRole("region", { name: "Sugestões de limpeza" });
    await settle(() => region() !== null && (region()?.textContent ?? "").includes("sumiu.md"));
    const text = region()?.textContent ?? "";
    expect(text).toContain("Duplicadas: c.md, d.md");
    expect(text).toContain("Link quebrado: sumiu.md");
    expect(text).toContain("Fora do índice: solta.md");
    expect(text).toContain("Contradição: a.md, b.md");
    expect(text).toContain("Nada é alterado sozinho");
    const before = readFileSync(join(dir, "c.md"), "utf8");
    await click("Abrir c.md");
    expect(readFileSync(join(dir, "c.md"), "utf8")).toBe(before);
    expect(screen.queryByLabelText("Conteúdo de c.md")).not.toBeNull();
  });

  test("memória em ordem diz que não há sugestões", async () => {
    await open((put) => {
      put("MEMORY.md", INDEX);
      put("user_role.md", ROLE);
    });
    await settle(() => screen.queryByText("Nenhuma sugestão: a memória está em ordem.") !== null);
    expect(screen.queryByText("Nenhuma sugestão: a memória está em ordem.")).not.toBeNull();
  });
});

describe("memoria-ui: quando a memória não pode ser lida", () => {
  test("uma pasta de memória que leva para fora é recusada pelo daemon, e a aba mostra que não há memória", async () => {
    const outside = tempDir("fd-outside-");
    const { dir } = await open((put) => put("MEMORY.md", INDEX));
    rmSync(dir, { recursive: true, force: true });
    symlinkSync(outside, dir);
    const tab = screen.queryByRole("tab", { name: "Memória" });
    await act(async () => {
      fireEvent.mouseDown(screen.queryByRole("tab", { name: "MCP" }) as HTMLElement, { button: 0 });
    });
    await act(async () => {
      fireEvent.mouseDown(tab as HTMLElement, { button: 0 });
    });
    await settle(() => screen.queryByText("Ainda não há memória neste projeto.") !== null);
    expect(screen.queryByText("Ainda não há memória neste projeto.")).not.toBeNull();
  });
});
