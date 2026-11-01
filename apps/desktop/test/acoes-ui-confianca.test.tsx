import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { waiter } from "./wait.ts";
import { workflowDaemon } from "./workflow-fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git under the in-process daemon: more than the default 5 s.
setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(6000);

const click = async (name: string | RegExp, scope: HTMLElement | null = null) => {
  const button = (scope ? within(scope) : screen).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const YAML = [
  "- name: testes",
  "  description: Roda os testes",
  '  run: ["./scripts/testes.sh"]',
  "",
].join("\n");

/** A host whose project versions one action that runs a script, on the project's Ações screen. */
async function online() {
  const d = await workflowDaemon(cleanups, {}, [], { actions: true });
  mkdirSync(join(d.repo, ".flightdeck"), { recursive: true });
  mkdirSync(join(d.repo, "scripts"), { recursive: true });
  writeFileSync(join(d.repo, ".flightdeck/actions.yaml"), YAML);
  writeFileSync(join(d.repo, "scripts/testes.sh"), "#!/bin/sh\necho ok\n");
  git(d.repo, "add", ".");
  git(d.repo, "commit", "-q", "-m", "ações");
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await sidebar.hostAction("Projetos", "alfa");
  await settle(() => screen.queryByRole("button", { name: "Ações de repo" }) !== null);
  await click("Ações de repo");
  await settle(() => row("testes") !== null);
  return d;
}
const row = (name: string) => screen.queryByRole("listitem", { name: `Ação ${name}` });

describe("acoes-ui-confianca: confiar numa ação versionada", () => {
  test("uma ação versionada nasce não confiada, e Confiar mostra o que ela executa antes de confiar", async () => {
    const d = await online();
    const item = row("testes") as HTMLElement;
    expect(item.textContent).toContain("Não confiada");
    expect(within(item).queryByRole("button", { name: "Confiar em testes" })).not.toBeNull();
    await click("Confiar em testes", item);
    const dialog = screen.queryByRole("alertdialog") as HTMLElement;
    expect(dialog.textContent).toContain("./scripts/testes.sh");
    // Cancelling trusts nothing.
    await click("Cancelar", dialog);
    expect((await d.actions?.list(d.project.id))?.actions[0]?.trusted).toBe(false);
    await click("Confiar em testes", row("testes"));
    await click("Confiar", screen.queryByRole("alertdialog"));
    await settle(() => row("testes")?.textContent?.includes("Confiada") === true);
    expect((await d.actions?.list(d.project.id))?.actions[0]?.trusted).toBe(true);
    expect(
      within(row("testes") as HTMLElement).queryByRole("button", { name: "Confiar em testes" }),
    ).toBeNull();
  });

  test("um script alterado depois de confiar pede confiança de novo, dizendo o que mudou", async () => {
    const d = await online();
    await click("Confiar em testes", row("testes"));
    await click("Confiar", screen.queryByRole("alertdialog"));
    await settle(() => row("testes")?.textContent?.includes("Confiada") === true);
    writeFileSync(join(d.repo, "scripts/testes.sh"), "#!/bin/sh\necho vazou $TOKEN\n");
    git(d.repo, "add", ".");
    git(d.repo, "commit", "-q", "-m", "muda o script");
    await sidebar.hostAction("Projetos", "alfa");
    await settle(() => screen.queryByRole("button", { name: "Ações de repo" }) !== null);
    await click("Ações de repo");
    await settle(
      () => row("testes")?.textContent?.includes("Mudou desde que foi confiada") === true,
    );
    const item = row("testes") as HTMLElement;
    expect(item.textContent).toContain("scripts/testes.sh");
    await click("Confiar em testes", item);
    expect((screen.queryByRole("alertdialog") as HTMLElement).textContent).toContain(
      "scripts/testes.sh",
    );
  });

  test("uma ação feita no app já nasce confiada e não oferece Confiar", async () => {
    const d = await online();
    await act(async () => {
      await d.actions?.save({
        projectId: d.project.id,
        definition: { name: "eco", description: "ecoa", run: ["echo", "oi"] },
      });
    });
    await sidebar.hostAction("Projetos", "alfa");
    await settle(() => screen.queryByRole("button", { name: "Ações de repo" }) !== null);
    await click("Ações de repo");
    await settle(() => row("eco") !== null);
    expect(within(row("eco") as HTMLElement).queryByRole("button", { name: /Confiar/ })).toBeNull();
  });
});
