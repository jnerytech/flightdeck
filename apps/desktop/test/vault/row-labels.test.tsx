import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { uiIdle } from "../wait.ts";
import { addedSecret } from "./added-secret.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { VaultPage } = await import("../../src/features/vault/page.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const ENV_VALUE = "API_URL=https://example.test\nAPI_KEY=label-test-value";
const TOKEN_VALUE = "ghp_labelTestToken0123456789WXYZ";

async function open(
  secrets: Array<Parameters<InstanceType<typeof AppStore>["secrets"]["add"]>[0]>,
) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  legacyDaemon(cleanups);
  for (const input of secrets) await addedSecret(store, input);
  render(<VaultPage store={store} />);
  await uiIdle();
}

/** The row's own text, hidden label included, as a screen reader reads it. */
const readAs = (text: string) => (screen.queryByText(text) as HTMLElement | null)?.textContent;

describe("cofre-ui: the row's detail line says what it is (#4421)", () => {
  test("the variable names of an env secret are read after Variáveis:", async () => {
    await open([{ name: "app env", type: "env", value: ENV_VALUE }]);
    expect(readAs("API_URL, API_KEY")).toBe("Variáveis: API_URL, API_KEY");
  });

  test("a token's hint is read after Dica:", async () => {
    await open([{ name: "github", type: "token", value: TOKEN_VALUE }]);
    expect(readAs("ghp_…WXYZ")).toBe("Dica: ghp_…WXYZ");
  });

  test("the label is for a screen reader only, so the row looks the same", async () => {
    await open([{ name: "app env", type: "env", value: ENV_VALUE }]);
    const label = screen.queryByText("Variáveis:");
    expect(label).not.toBeNull();
    expect(label?.className).toContain("sr-only");
  });

  test("an env secret with no variable name has no detail line to label", async () => {
    await open([{ name: "empty env", type: "env", value: "not a variable line" }]);
    expect(screen.queryByText("Variáveis:")).toBeNull();
  });
});

describe("cofre-ui: the tags are a named list (#4421)", () => {
  test("the tags of a secret are the items of a list named Etiquetas", async () => {
    await open([{ name: "github", type: "token", value: TOKEN_VALUE, tags: ["ci", "prod"] }]);
    const list = screen.queryByRole("list", { name: "Etiquetas" });
    expect(list).not.toBeNull();
    const items = within(list as HTMLElement).queryAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["ci", "prod"]);
  });

  test("a secret with no tag draws no list", async () => {
    await open([{ name: "github", type: "token", value: TOKEN_VALUE }]);
    expect(screen.queryByRole("list", { name: "Etiquetas" })).toBeNull();
  });

  test("each row has its own tag list", async () => {
    await open([
      { name: "one", type: "token", value: TOKEN_VALUE, tags: ["a"] },
      { name: "two", type: "token", value: TOKEN_VALUE, tags: ["b"] },
    ]);
    expect(screen.queryAllByRole("list", { name: "Etiquetas" })).toHaveLength(2);
  });
});
