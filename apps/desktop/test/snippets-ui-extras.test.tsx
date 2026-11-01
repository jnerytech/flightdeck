import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { snippetsHost } from "./snippets-ui-setup.ts";
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

async function open(
  seed?: (
    store: InstanceType<typeof AppStore>,
    h: Awaited<ReturnType<typeof snippetsHost>>,
  ) => Promise<void>,
) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store);
  await seed?.(store, h);
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("snippets") === true);
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
  await act(() => Bun.sleep(100));
}

const rowNames = () => {
  const list = screen.queryByRole("list", { name: "Snippets" });
  return list
    ? within(list)
        .queryAllByRole("listitem")
        .map((r) => r.querySelector("[data-name]")?.textContent ?? "")
    : [];
};

describe("snippets-ui: use from the screen", () => {
  test("a used snippet moves up, after the favorites", async () => {
    const { store } = await open(async (s) => {
      s.globalSnippets.save({ name: "a-um", type: "prompt", text: "Um." });
      s.globalSnippets.save({ name: "b-dois", type: "prompt", text: "Dois." });
    });
    await click("Snippets");
    await fill("Projeto", "@global");
    expect(rowNames()).toEqual(["a-um", "b-dois"]);
    await click("Usar b-dois");
    await click("Copiar");
    await fill("Projeto", "");
    await fill("Projeto", "@global");
    expect(rowNames()).toEqual(["b-dois", "a-um"]);
    expect(store.globalSnippets.list()[0]?.uses).toBe(1);
  });

  test("an untrusted file's command only pastes: running it is off, with the reason", async () => {
    const { repo } = await open(async (_s, h) => {
      h.writeFile('- name: testes\n  type: command\n  run: "bun test"\n');
    });
    await click("Snippets");
    await fill("Projeto", repo);
    await click("Usar testes");
    // The dialog belongs to the screen, so the terminal is not on it: only the new tab is offered.
    const run = screen.queryByRole("button", {
      name: "Rodar numa aba nova",
    }) as HTMLButtonElement | null;
    expect(run?.disabled).toBe(true);
    expect(
      screen.queryByText("Arquivo versionado não confiável: este comando só cola, sem rodar."),
    ).not.toBeNull();
  });

  test("a global command runs in a new tab on the host, at the folder given", async () => {
    const { store, hostId, d } = await open(async (s) => {
      s.globalSnippets.save({ name: "eco", type: "command", run: "echo oi" });
    });
    await click("Snippets");
    await fill("Projeto", "@global");
    await click("Usar eco");
    await fill("Pasta", d.project);
    await click("Rodar numa aba nova");
    await settle(() => store.router.current.name === "terminal");
    expect(store.router.current).toMatchObject({ name: "terminal", host: hostId });
    await settle(() => (d.ptys.spawned[0]?.written ?? []).join("").includes("echo oi"));
    expect(d.ptys.spawned[0]?.cwd).toBe(d.project);
    expect(d.ptys.spawned[0]?.written.join("")).toContain("echo oi\r");
  });
});
