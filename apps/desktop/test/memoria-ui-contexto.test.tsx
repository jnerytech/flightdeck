import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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

/** The Agente screen of the project, on its Contexto tab. */
async function open(seed: (ctx: { put: (n: string, t: string) => void; repo: string }) => void) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await memoriaHost(cleanups, store);
  seed({ put: h.put, repo: h.repo });
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
  await settle(() => screen.queryByRole("tab", { name: "Contexto" }) !== null);
  const tab = screen.queryByRole("tab", { name: "Contexto" });
  if (tab) {
    await act(async () => {
      fireEvent.mouseDown(tab, { button: 0 });
    });
  }
  return h;
}

const budget = () => screen.queryByRole("region", { name: "Orçamento de contexto" });

describe("memoria-ui: o orçamento de contexto", () => {
  test("a aba Contexto lista cada fonte com os tokens estimados e se entra na partida ou só quando Claude lê, e soma a partida", async () => {
    await open(({ put, repo }) => {
      writeFileSync(join(repo, "CLAUDE.md"), "p".repeat(400));
      writeFileSync(join(repo, "CLAUDE.local.md"), "l".repeat(40));
      put("MEMORY.md", "- [A](a.md) — a\n");
      put("a.md", "corpo\n");
    });
    await settle(() => budget() !== null && (budget()?.textContent ?? "").includes("CLAUDE.md"));
    const rows = [...(budget()?.querySelectorAll("li") ?? [])].map((r) => r.textContent ?? "");
    const row = (part: string) => rows.find((r) => r.includes(part)) ?? "";
    const claude = rows.find((r) => r.includes("CLAUDE.md") && !r.includes("local")) ?? "";
    expect(claude).toContain("≈ 100 tokens");
    expect(claude).toContain("Na partida");
    expect(row("CLAUDE.local.md")).toContain("≈ 10 tokens");
    expect(row("a.md")).toContain("Sob demanda");
    expect(budget()?.textContent ?? "").toContain("Na partida: ≈ ");
  });

  test("a memória que cabe diz quantas linhas e bytes entram", async () => {
    await open(({ put }) => {
      put("MEMORY.md", "- [A](a.md) — a\n- [B](b.md) — b\n");
      put("a.md", "a\n");
      put("b.md", "b\n");
    });
    await settle(() => (budget()?.textContent ?? "").includes("MEMORY.md"));
    expect(budget()?.textContent ?? "").toContain("Entram 2 de 2 linhas do MEMORY.md");
    expect(screen.queryByText(/Só as primeiras/)).toBeNull();
  });

  test("passando de 200 linhas, destaca o corte e mostra o que fica de fora: as linhas e os arquivos que só elas citam", async () => {
    await open(({ put }) => {
      const lines = Array.from(
        { length: 203 },
        (_, i) => `- [Nota ${i + 1}](nota_${i + 1}.md) — n`,
      );
      put("MEMORY.md", `${lines.join("\n")}\n`);
      put("nota_1.md", "x\n");
      put("nota_203.md", "x\n");
    });
    await settle(() => (budget()?.textContent ?? "").includes("MEMORY.md"));
    const alert = screen.queryByText(/Só as primeiras 200 linhas do MEMORY.md entram/);
    expect(alert).not.toBeNull();
    const left = screen.queryByRole("list", { name: "Linhas que ficam de fora" });
    expect([...(left?.querySelectorAll("li") ?? [])].map((li) => li.textContent)).toEqual([
      "- [Nota 201](nota_201.md) — n",
      "- [Nota 202](nota_202.md) — n",
      "- [Nota 203](nota_203.md) — n",
    ]);
    expect(budget()?.textContent ?? "").toContain(
      "Arquivos que só essas linhas citam: nota_203.md",
    );
  });

  test("sem memória nem CLAUDE.md, a aba não quebra e não fala de corte", async () => {
    await open(() => {});
    await settle(() => budget() !== null);
    expect(budget()).not.toBeNull();
    expect(screen.queryByText(/Só as primeiras/)).toBeNull();
  });

  test("passando de 25 KB com poucas linhas, o aviso diz que o corte foi pelo tamanho", async () => {
    await open(({ put }) => {
      const lines = Array.from(
        { length: 30 },
        (_, i) => `- ${String(i).padStart(2, "0")} ${"x".repeat(1020)}`,
      );
      put("MEMORY.md", `${lines.join("\n")}\n`);
    });
    await settle(() => screen.queryByText(/Só os primeiros 25 KB do MEMORY.md entram/) !== null);
    expect(screen.queryByText(/Só os primeiros 25 KB do MEMORY.md entram/)).not.toBeNull();
  });
});
