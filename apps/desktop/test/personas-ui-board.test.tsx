import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
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

const LABEL = "Persona padrão em Em revisão";

async function click(name: string) {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(150));
}

const options = () =>
  [...((screen.queryByLabelText(LABEL) as HTMLSelectElement | null)?.options ?? [])].map(
    (o) => o.value,
  );

async function choose(value: string) {
  const field = screen.queryByLabelText(LABEL);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
}

describe("personas-ui: the board", () => {
  test("a project keeps a default persona per column, and clearing it takes it away", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const { d, hostId, projectId } = await personasHost(cleanups, store);
    render(<App store={store} />);
    await settle(
      () => store.getState().hosts[0]?.hostInfo?.features?.includes("personas") === true,
    );
    await act(async () => {
      store.router.push({ name: "projects", host: hostId });
    });
    await settle(() => screen.queryByRole("button", { name: "Editar repo" }) !== null);
    await click("Editar repo");
    await settle(() => options().length > 1);
    expect(options()).toContain("revisor");
    await choose("revisor");
    await click("Salvar projeto");
    await poll(() => d.board.getProject(projectId).personaByColumn.review === "revisor");
    expect(d.board.getProject(projectId).personaByColumn).toEqual({ review: "revisor" });
    await click("Editar repo");
    await settle(
      () => (screen.queryByLabelText(LABEL) as HTMLSelectElement | null)?.value === "revisor",
    );
    await choose("");
    await click("Salvar projeto");
    await poll(() => d.board.getProject(projectId).personaByColumn.review === undefined);
    expect(d.board.getProject(projectId).personaByColumn).toEqual({});
  });
});
