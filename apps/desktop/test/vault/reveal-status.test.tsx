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
  usingFakeTimers = false;
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const realSetTimeout = globalThis.setTimeout;
let usingFakeTimers = false;
const VALUE = "reveal-status-value-0123456789";

async function open() {
  const { platform } = memoryPlatform();
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.roster.add({ name: "h", url: daemon.url, token: TOKEN });
  await addedSecret(store, { name: "github", type: "password", value: VALUE });
  render(<VaultPage store={store} />);
}

const click = async (name: string) => {
  const button = screen.getByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
};

/** Reveal github by typing the word and confirming, as a person does. */
async function reveal() {
  await click("Revelar github");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Digite revelar para confirmar"), {
      target: { value: "revelar" },
    });
  });
  await click("Revelar");
  // The vault answers on a later turn and the clock may be faked: let a few milliseconds pass.
  for (let turn = 0; turn < 50 && screen.queryByText(VALUE) === null; turn++) {
    await act(async () => {
      if (usingFakeTimers) jest.advanceTimersByTime(1);
      await Promise.resolve();
      await new Promise<void>((resolve) => realSetTimeout(resolve, 2));
    });
  }
  expect(screen.queryByText(VALUE)).not.toBeNull();
}

const status = () => screen.queryByRole("status");
const pass = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe("a revealed value tells a screen reader what happens to it (#2603)", () => {
  test("the status line says for how long it shows, warns 5 seconds before it hides, and says when it is hidden", async () => {
    await open();
    jest.useFakeTimers();
    usingFakeTimers = true;
    await reveal();
    expect(status()?.textContent).toBe("Visível por 10 s");
    await pass(4_800);
    expect(status()?.textContent).toBe("Visível por 10 s");
    await pass(300);
    expect(status()?.textContent).toBe("Some em 5 segundos");
    await pass(4_500);
    expect(screen.queryByText(VALUE)).not.toBeNull();
    await pass(500);
    expect(screen.queryByText(VALUE)).toBeNull();
    expect(status()?.textContent).toBe("Oculto");
  });

  test("the value is never inside the status line", async () => {
    await open();
    await reveal();
    expect(status()).not.toBeNull();
    expect(status()?.textContent?.includes(VALUE)).toBe(false);
    expect(status()?.contains(screen.getByText(VALUE))).toBe(false);
  });

  test("after the confirmation closes, the focus is back on the row's Reveal button", async () => {
    await open();
    await reveal();
    const button = screen.getByRole("button", { name: "Revelar github" });
    await settle(() => document.activeElement === button);
    expect(document.activeElement).toBe(button);
  });

  test("cancelling the confirmation also puts the focus back on the Reveal button", async () => {
    await open();
    await click("Revelar github");
    await click("Cancelar");
    const button = screen.getByRole("button", { name: "Revelar github" });
    await settle(() => document.activeElement === button);
    expect(document.activeElement).toBe(button);
  });
});
