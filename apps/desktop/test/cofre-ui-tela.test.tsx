import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const TOKEN_VALUE = "ghp_screenTestToken0123456789WXYZ";
const ENV_VALUE = "API_URL=https://example.test\nAPI_KEY=env-screen-secret-value";

async function open(setup?: (store: InstanceType<typeof AppStore>) => Promise<void>) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  // The app shows the add-host form until a host exists.
  const daemon = legacyDaemon(cleanups);
  await store.addHost({ name: "h", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  await setup?.(store);
  render(<App store={store} />);
  const nav = screen.queryByRole("button", { name: "Cofre" });
  expect(nav).not.toBeNull();
  await act(async () => {
    fireEvent.click(nav as HTMLElement);
  });
  return store;
}

describe("cofre-ui: the screen", () => {
  test("the sidebar's Cofre item opens the vault screen", async () => {
    await open();
    expect(screen.queryByRole("heading", { name: "Cofre", level: 1 })).not.toBeNull();
  });

  test("an empty vault says so and offers no row", async () => {
    await open();
    expect(screen.queryByText("Nenhum segredo guardado.")).not.toBeNull();
    expect(screen.queryByRole("list", { name: "Segredos" })).toBeNull();
  });

  test("the empty vault offers its own button to keep the first secret", async () => {
    await open();
    const button = screen.queryByRole("button", { name: "Guardar o primeiro segredo" });
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    await settle(() => screen.queryByLabelText("Nome") !== null);
    expect(screen.queryByLabelText("Nome")).not.toBeNull();
  });

  test("each secret shows its name, type and tags", async () => {
    await open(async (store) => {
      await store.addSecret({
        name: "github",
        type: "token",
        value: TOKEN_VALUE,
        tags: ["ci", "prod"],
      });
      await store.addSecret({ name: "app env", type: "env", value: ENV_VALUE });
    });
    const rows = within(await screen.findByRole("list", { name: "Segredos" })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(2);
    const github = within(rows[0] as HTMLElement);
    expect(github.queryByText("github")).not.toBeNull();
    expect(github.queryByText("Token")).not.toBeNull();
    expect(github.queryByText("ci")).not.toBeNull();
    expect(github.queryByText("prod")).not.toBeNull();
    expect(within(rows[1] as HTMLElement).queryByText("Variáveis de ambiente")).not.toBeNull();
  });

  test("the row shows what describes the secret (a token's hint, an env's names) and never the value", async () => {
    await open(async (store) => {
      await store.addSecret({ name: "github", type: "token", value: TOKEN_VALUE });
      await store.addSecret({ name: "app env", type: "env", value: ENV_VALUE });
    });
    expect(await screen.findByText("ghp_…WXYZ")).not.toBeNull();
    expect(await screen.findByText("API_URL, API_KEY")).not.toBeNull();
    const html = document.body.innerHTML;
    expect(html).not.toContain(TOKEN_VALUE);
    expect(html).not.toContain("env-screen-secret-value");
  });
});
