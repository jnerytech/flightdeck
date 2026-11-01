import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { actionSeedFromCommand } from "../src/lib/snippets.ts";
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

const BEARER = "abcdefghijklmnopqrstuvwxyz0123456789";
const GH = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

describe("snippets-ui: a secret's snippet becomes an action", () => {
  test("the seed takes the command as argv, without the secret, and names an env entry for it", () => {
    expect(
      actionSeedFromCommand(
        "deploy",
        `curl -H "Authorization: Bearer ${BEARER}" https://api.example.test/deploy`,
      ),
    ).toEqual({
      name: "deploy",
      run: ["curl", "-H", "https://api.example.test/deploy"],
      env: ["SECRET"],
    });
    expect(actionSeedFromCommand("release", `GITHUB_TOKEN=${GH} gh release create v1`)).toEqual({
      name: "release",
      run: ["gh", "release", "create", "v1"],
      env: ["GITHUB_TOKEN"],
    });
    expect(actionSeedFromCommand("api", "tool --api-key=s3cr3t-value-123456 --verbose")).toEqual({
      name: "api",
      run: ["tool", "--verbose"],
      env: ["API_KEY"],
    });
    expect(JSON.stringify(actionSeedFromCommand("x", `export GITHUB_TOKEN=${GH}`))).not.toContain(
      "ghp_",
    );
  });

  test("Transformar em ação opens the project's action form filled in, with the secret to choose and its value nowhere", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const h = await snippetsHost(cleanups, store, {
      snippets: true,
      terminals: true,
      actions: true,
    });
    render(<App store={store} />);
    await settle(() => screen.queryByRole("button", { name: "Snippets" }) !== null);
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Snippets" }) as HTMLElement);
    });
    await act(() => Bun.sleep(100));
    const fill = async (label: string, value: string) => {
      const field = screen.queryByLabelText(label);
      expect(field).not.toBeNull();
      await act(async () => {
        fireEvent.change(field as HTMLElement, { target: { value } });
      });
      await act(() => Bun.sleep(60));
    };
    const click = async (name: string) => {
      const button = screen.queryByRole("button", { name });
      expect(button).not.toBeNull();
      await act(async () => {
        fireEvent.click(button as HTMLElement);
      });
      await act(() => Bun.sleep(150));
    };
    await fill("Projeto", h.repo);
    await click("Novo snippet");
    await fill("Nome", "deploy");
    await fill(
      "Comando",
      `curl -H "Authorization: Bearer ${BEARER}" https://api.example.test/deploy`,
    );
    await click("Salvar snippet");
    await click("Transformar em ação");
    await settle(() => screen.queryByLabelText("Nome da ação") !== null);
    expect((screen.queryByLabelText("Nome da ação") as HTMLInputElement | null)?.value).toBe(
      "deploy",
    );
    expect(
      (screen.queryByLabelText("Comando, um argumento por linha") as HTMLTextAreaElement | null)
        ?.value,
    ).toBe("curl\n-H\nhttps://api.example.test/deploy");
    expect((screen.queryByLabelText("Nome da variável 1") as HTMLInputElement | null)?.value).toBe(
      "SECRET",
    );
    expect(
      (screen.queryByLabelText("Segredo da variável 1") as HTMLSelectElement | null)?.value,
    ).toBe("");
    expect(document.body.innerHTML).not.toContain(BEARER);
    expect(JSON.stringify(store.getState())).not.toContain(BEARER);
  });
});
