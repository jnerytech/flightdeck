import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);
afterEach(cleanup);

const TOKEN_VALUE = "ghp_screenTestToken0123456789WXYZ";
const ENV_VALUE = "API_URL=https://example.test\nAPI_KEY=env-screen-secret-value";

async function open(setup?: (store: InstanceType<typeof AppStore>) => Promise<void>) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
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
    expect(screen.queryAllByRole("listitem")).toEqual([]);
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
    const rows = await screen.findAllByRole("listitem");
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
