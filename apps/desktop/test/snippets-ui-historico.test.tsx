import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { snippetsHost } from "./snippets-ui-setup.ts";

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

const TOKEN_LINE = "export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const VAULT_VALUE = "cofre-valor-de-teste-77";
const VAULT_LINE = `deploy --key ${VAULT_VALUE}`;
const ENV_VALUE = "envsecretvalue99";
const ENV_LINE = `release --auth "${ENV_VALUE}"`;

/** A fixture bash history (never the real one) and a vault holding one value that appears in it. */
async function open() {
  const dir = mkdtempSync(join(tmpdir(), "fd-hist-"));
  const bash = join(dir, "bash_history");
  writeFileSync(
    bash,
    [
      "git status",
      "bun test",
      "git status",
      TOKEN_LINE,
      "git status",
      "bun test",
      VAULT_LINE,
      ENV_LINE,
      "docker compose up -d",
    ].join("\n"),
  );
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store, { snippets: { history: { bash } } });
  await store.addSecret({ name: "deploy key", type: "password", value: VAULT_VALUE });
  await store.addSecret({
    name: "release env",
    type: "env",
    value: `API_URL=https://example.test\nRELEASE_AUTH="${ENV_VALUE}"`,
  });
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Snippets" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Snippets" }) as HTMLElement);
  });
  await act(() => Bun.sleep(80));
  await click("Importar do histórico do shell");
  return { store, ...h };
}

async function click(name: string) {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(120));
}

const lines = () => {
  const list = screen.queryByRole("list", { name: "Histórico do shell" });
  return list ? within(list).queryAllByRole("listitem") : [];
};

describe("snippets-ui: import from the shell history", () => {
  test("the preview is ordered by use, each line with its count, and lines with a secret are hidden and cannot be ticked", async () => {
    await open();
    const texts = lines().map((li) => li.textContent ?? "");
    expect(texts[0]).toContain("git status");
    expect(texts[0]).toContain("3×");
    expect(texts[1]).toContain("bun test");
    expect(screen.queryByLabelText("git status")).not.toBeNull();
    expect(screen.queryByText("Linha oculta: token do GitHub")).not.toBeNull();
    expect(screen.queryAllByText("Linha oculta: valor do cofre").length).toBeGreaterThan(0);
    expect(lines().filter((li) => li.querySelector("input[type=checkbox]") === null)).toHaveLength(
      3,
    );
    expect(document.body.innerHTML).not.toContain("ghp_abcdef");
    expect(document.body.innerHTML).not.toContain(VAULT_VALUE);
  });

  test("Importar selecionados is disabled with nothing ticked, and says why", async () => {
    await open();
    const button = screen.queryByRole("button", {
      name: "Importar selecionados",
    }) as HTMLButtonElement | null;
    expect(button?.disabled).toBe(true);
    const reason = screen.queryByText("Marque ao menos uma linha.");
    expect(reason).not.toBeNull();
    expect(button?.getAttribute("aria-describedby")).toBe(reason?.id ?? "?");
  });

  test("the ticked lines go to the host's snippets, tagged histórico", async () => {
    const { store, hostId } = await open();
    await act(async () => {
      fireEvent.click(screen.queryByLabelText("git status") as HTMLElement);
      fireEvent.click(screen.queryByLabelText("docker compose up -d") as HTMLElement);
    });
    await click("Importar selecionados");
    expect(screen.queryByText("Importados: 2")).not.toBeNull();
    const listed = await store.hostCommand(hostId, "snippets.list", {});
    expect(listed?.snippets.map((s) => [s.run, s.tags]).sort()).toEqual([
      ["docker compose up -d", ["histórico"]],
      ["git status", ["histórico"]],
    ]);
  });

  test("or to the app's global snippets, and then not to the host", async () => {
    const { store, hostId } = await open();
    await act(async () => {
      fireEvent.click(screen.queryByLabelText("bun test") as HTMLElement);
      fireEvent.change(screen.queryByLabelText("Importar para") as HTMLElement, {
        target: { value: "global" },
      });
    });
    await click("Importar selecionados");
    expect(store.globalSnippets.list().map((s) => [s.run, s.tags])).toEqual([
      ["bun test", ["histórico"]],
    ]);
    expect((await store.hostCommand(hostId, "snippets.list", {}))?.snippets).toEqual([]);
  });

  test("the versioned file of a project is never offered as a destination", async () => {
    await open();
    const target = screen.queryByLabelText("Importar para") as HTMLSelectElement | null;
    expect([...(target?.options ?? [])].map((o) => o.value)).toEqual(["host", "global"]);
  });

  test("revealing shows a line the patterns flagged, still not selectable; a vault value is never shown", async () => {
    await open();
    await click("Revelar linhas ocultas");
    expect(screen.queryByText(TOKEN_LINE)).not.toBeNull();
    expect(screen.queryByLabelText(TOKEN_LINE)).toBeNull();
    expect(document.body.innerHTML).not.toContain(VAULT_VALUE);
  });

  test("one value of an env secret is enough to hide and lock a line, and the values are not kept anywhere", async () => {
    const { store } = await open();
    expect(document.body.innerHTML).not.toContain(ENV_VALUE);
    expect(screen.queryAllByText("Linha oculta: valor do cofre")).toHaveLength(2);
    expect(screen.queryByLabelText(ENV_LINE)).toBeNull();
    expect(JSON.stringify(store.getState())).not.toContain(ENV_VALUE);
    expect(JSON.stringify(store.getState())).not.toContain(VAULT_VALUE);
  });

  test("a line ticked and then unticked is not imported", async () => {
    const { store, hostId } = await open();
    await act(async () => {
      fireEvent.click(screen.queryByLabelText("git status") as HTMLElement);
      fireEvent.click(screen.queryByLabelText("docker compose up -d") as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(screen.queryByLabelText("docker compose up -d") as HTMLElement);
    });
    await click("Importar selecionados");
    const listed = await store.hostCommand(hostId, "snippets.list", {});
    expect(listed?.snippets.map((s) => s.run)).toEqual(["git status"]);
  });

  test("closing the panel and opening it again shows the history again", async () => {
    await open();
    await click("Importar do histórico do shell");
    expect(screen.queryByRole("button", { name: "Importar selecionados" })).toBeNull();
    await click("Importar do histórico do shell");
    expect(screen.queryByRole("button", { name: "Importar selecionados" })).not.toBeNull();
  });

  test("a line imported to the app next to a global snippet of the same name gets a name of its own", async () => {
    const { store } = await open();
    store.globalSnippets.save({ name: "bun-test", type: "command", run: "bun test --watch" });
    await act(async () => {
      fireEvent.click(screen.queryByLabelText("bun test") as HTMLElement);
      fireEvent.change(screen.queryByLabelText("Importar para") as HTMLElement, {
        target: { value: "global" },
      });
    });
    await click("Importar selecionados");
    const names = store.globalSnippets.list().map((s) => s.name);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(store.globalSnippets.list().find((s) => s.run === "bun test")?.name).not.toBe(
      "bun-test",
    );
  });
});
