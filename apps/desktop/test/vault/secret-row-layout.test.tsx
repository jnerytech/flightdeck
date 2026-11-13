import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { waiter } from "../wait.ts";

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

const settle = waiter(4000);
const USED_AT = Date.UTC(2026, 9, 30, 12);

/** The page over a store with one secret that was last used at `USED_AT`. */
async function open(lastUsedAt = USED_AT) {
  const { platform } = memoryPlatform();
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.roster.add({ name: "box", url: daemon.url, token: TOKEN });
  const value = "row-layout-value-0123456789";
  const meta = await store.secrets.add({ name: "deploy", type: "password", value });
  if (meta === null) throw new Error("the fake daemon refused the secret");
  await store.vault.restore({ ...meta, lastUsedAt }, value);
  store.secrets.update(meta.id, {});
  render(<VaultPage store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Editar deploy" }) !== null);
  return store;
}

describe("cofre-ui: a secret row on a narrow screen (#2605)", () => {
  test("the row's buttons wrap instead of running off the screen", async () => {
    await open();
    const buttons = screen.queryByRole("button", { name: "Revelar deploy" })?.parentElement;
    expect(buttons?.className.split(" ").includes("flex-wrap")).toBe(true);
  });

  test("the last use is written the way the rest of the app writes a date and time", async () => {
    const store = await open();
    const when = store.formatDateTime(new Date(USED_AT).toISOString());
    expect(screen.queryByText(`Último uso: ${when}`) === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a last use no date can hold does not stop the page from showing", async () => {
    let failed = false;
    try {
      await open(1e300);
    } catch {
      failed = true;
    }
    expect(failed).toBe(false);
  });
});
