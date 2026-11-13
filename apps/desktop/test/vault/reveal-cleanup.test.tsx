import { afterEach, describe, expect, jest, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { VaultPage } = await import("../../src/features/vault/page.tsx");
const { addedSecret } = await import("./added-secret.ts");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  jest.useRealTimers();
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The page over a store that holds these secrets, in this order. */
async function open(names: string[]) {
  const { platform } = memoryPlatform();
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.roster.add({ name: "h", url: daemon.url, token: TOKEN });
  for (const name of names)
    await addedSecret(store, { name, type: "password", value: `${name}-value-0123456789` });
  render(<VaultPage store={store} />);
  return store;
}

const click = async (name: string) => {
  const button = screen.getByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
};

const type = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
};

const status = () => screen.queryByRole("status");

/** Reveals a secret by typing the word and confirming, as a person does. */
async function reveal(name: string) {
  await click(`Revelar ${name}`);
  await type("Digite revelar para confirmar", "revelar");
  await click("Revelar");
  await settle(() => screen.queryByText(`${name}-value-0123456789`) !== null);
}

/** Removes a secret by typing its name and confirming. */
async function remove(name: string) {
  await click(`Remover ${name}`);
  await type(`Digite ${name} para confirmar`, name);
  await click("Remover");
}

describe("the reveal status and the focus after a removal (#2636)", () => {
  test("the Hidden notice leaves the status line a few seconds after it appears", async () => {
    await open(["github"]);
    jest.useFakeTimers();
    await reveal("github");
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(status()?.textContent).toBe("Oculto");
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(status()?.textContent).toBe("");
  });

  test("removing the secret whose value is shown clears the status line at once", async () => {
    const store = await open(["github"]);
    await reveal("github");
    expect(status()?.textContent).toBe("Visível por 10 s");
    await remove("github");
    await settle(() => store.getState().secrets.length === 0);
    await settle(() => status()?.textContent === "");
    expect(status()?.textContent).toBe("");
  });

  test("after a removal the focus goes to the next row's Edit button", async () => {
    const store = await open(["alpha", "beta", "gamma"]);
    await remove("beta");
    await settle(() => store.getState().secrets.length === 2);
    const next = screen.getByRole("button", { name: "Editar gamma" });
    await settle(() => document.activeElement === next);
    expect(document.activeElement).toBe(next);
  });

  test("removing the last row puts the focus on the previous row's Edit button", async () => {
    const store = await open(["alpha", "beta"]);
    await remove("beta");
    await settle(() => store.getState().secrets.length === 1);
    const previous = screen.getByRole("button", { name: "Editar alpha" });
    await settle(() => document.activeElement === previous);
    expect(document.activeElement).toBe(previous);
  });
});
