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

const realSetTimeout = globalThis.setTimeout;
const VALUE = "reveal-row-value-0123456789";

/** Two secrets, so the row of the revealed one is told apart from the other. */
async function open() {
  const { platform } = memoryPlatform();
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.roster.add({ name: "h", url: daemon.url, token: TOKEN });
  await addedSecret(store, { name: "github", type: "password", value: VALUE });
  await addedSecret(store, { name: "gitlab", type: "password", value: "other-value-0123456789" });
  render(<VaultPage store={store} />);
}

const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

const rowOf = (name: string) =>
  screen.getByRole("button", { name: `Revelar ${name}` }).closest("li") as HTMLElement;

async function reveal() {
  await click("Revelar github");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Digite revelar para confirmar"), {
      target: { value: "revelar" },
    });
  });
  await click("Revelar");
  for (let turn = 0; turn < 50 && screen.queryByText(VALUE) === null; turn++) {
    await act(async () => {
      await new Promise<void>((resolve) => realSetTimeout(resolve, 2));
    });
  }
  expect(screen.queryByText(VALUE)).not.toBeNull();
}

const pass = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe("a revealed value is told in its own row (#4417)", () => {
  test("the status line, the Hide now button and the labelled value sit in the revealed row", async () => {
    await open();
    await reveal();
    const row = within(rowOf("github"));
    expect(row.queryByRole("status")?.textContent).toBe("github visível por 10 s");
    expect(row.queryByRole("button", { name: "Ocultar agora: github" })).not.toBeNull();
    expect(row.queryByText("Valor de github:")).not.toBeNull();
    expect(row.queryByText(VALUE)).not.toBeNull();
  });

  test("the other row shows no status and no Hide now button", async () => {
    await open();
    await reveal();
    const other = within(rowOf("gitlab"));
    expect(other.queryByRole("status")).toBeNull();
    expect(other.queryByRole("button", { name: /Ocultar agora/ })).toBeNull();
  });

  test("Hide now hides the value at once, says so with the name, and the focus goes back to Revelar", async () => {
    await open();
    await reveal();
    await click("Ocultar agora: github");
    expect(screen.queryByText(VALUE)).toBeNull();
    expect(within(rowOf("github")).queryByRole("status")?.textContent).toBe("github oculto");
    const button = screen.getByRole("button", { name: "Revelar github" });
    await settle(() => document.activeElement === button);
    expect(document.activeElement).toBe(button);
  });

  test("when the time ends, the status names the secret and the focus leaves no hidden button behind", async () => {
    await open();
    jest.useFakeTimers();
    await reveal();
    await act(async () => {
      screen.getByRole("button", { name: "Ocultar agora: github" }).focus();
    });
    await pass(5_100);
    expect(within(rowOf("github")).queryByRole("status")?.textContent).toBe(
      "github some em 5 segundos",
    );
    await pass(5_000);
    expect(screen.queryByText(VALUE)).toBeNull();
    expect(within(rowOf("github")).queryByRole("status")?.textContent).toBe("github oculto");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Revelar github" }));
  });

  test("the status never holds the value", async () => {
    await open();
    await reveal();
    const status = within(rowOf("github")).queryByRole("status");
    expect(status?.textContent?.includes(VALUE)).toBe(false);
  });
});
