import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { VaultPage } = await import("../../src/features/vault/page.tsx");

setDefaultTimeout(20_000);
afterEach(cleanup);

/** Adds a secret through the store; a refusal fails the test by assertion. */
async function addedSecret(
  store: InstanceType<typeof AppStore>,
  input: Parameters<InstanceType<typeof AppStore>["secrets"]["add"]>[0],
) {
  const meta = await store.secrets.add(input);
  expect(meta).not.toBeNull();
  return meta as NonNullable<typeof meta>;
}

const TOKEN_A = "ghp_aaaaaaaaaaaaaaaa1111";
const TOKEN_B = "glpat-bbbbbbbbbbbbbbbb2222";

/** A store over a platform whose vault counts the ids it is asked to read. */
function counted() {
  const { platform } = memoryPlatform();
  const reads: string[] = [];
  const get = platform.vault.get.bind(platform.vault);
  platform.vault.get = async (id) => {
    reads.push(id);
    return get(id);
  };
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  // The history scan has its own reader of every value, outside this issue: the count is the page's.
  store.scan.refresh = async () => {};
  return { store, reads };
}

describe("the vault page reads a value only to describe a new row (#2612)", () => {
  test("a password is never read, a token or an env set is read once, and a list change reads only what is new", async () => {
    const { store, reads } = counted();
    const password = await addedSecret(store, { name: "login", type: "password", value: "pw-1" });
    const token = await addedSecret(store, { name: "github", type: "token", value: TOKEN_A });
    const env = await addedSecret(store, { name: "prod", type: "env", value: "A=1\nB=2" });
    render(<VaultPage store={store} />);
    await settle(
      () => screen.queryByText("ghp_…1111") !== null && screen.queryByText("A, B") !== null,
    );
    expect(reads.slice().sort()).toEqual([token.id, env.id].sort());
    expect(reads).not.toContain(password.id);

    const second = await addedSecret(store, { name: "gitlab", type: "token", value: TOKEN_B });
    await settle(() => screen.queryByText("glpat-…2222") !== null);
    expect(reads.filter((id) => id === token.id)).toHaveLength(1);
    expect(reads.filter((id) => id === env.id)).toHaveLength(1);
    expect(reads.filter((id) => id === second.id)).toHaveLength(1);
  });

  test("editing one secret reads at most that secret again; a removed one leaves nothing behind", async () => {
    const { store, reads } = counted();
    const token = await addedSecret(store, { name: "github", type: "token", value: TOKEN_A });
    const other = await addedSecret(store, { name: "gitlab", type: "token", value: TOKEN_B });
    render(<VaultPage store={store} />);
    await settle(() => screen.queryByText("ghp_…1111") !== null);
    await settle(() => screen.queryByText("glpat-…2222") !== null);
    await act(async () => {
      store.secrets.update(token.id, { tags: ["ci"] });
    });
    await settle(() => screen.queryByText("ghp_…1111") !== null);
    expect(reads.filter((id) => id === other.id)).toHaveLength(1);
    await act(async () => {
      await store.secrets.remove(token.id);
    });
    await settle(() => screen.queryByText("ghp_…1111") === null);
    expect(reads.filter((id) => id === other.id)).toHaveLength(1);
  });

  test("leaving the page forgets what it derived: coming back reads again, so nothing lingers", async () => {
    const { store, reads } = counted();
    await addedSecret(store, { name: "github", type: "token", value: TOKEN_A });
    const first = render(<VaultPage store={store} />);
    await settle(() => screen.queryByText("ghp_…1111") !== null);
    expect(reads).toHaveLength(1);
    first.unmount();
    render(<VaultPage store={store} />);
    await settle(() => screen.queryByText("ghp_…1111") !== null);
    expect(reads).toHaveLength(2);
  });

  test("a secret restored over its id is described from its new value", async () => {
    const { store } = counted();
    const token = await addedSecret(store, { name: "github", type: "token", value: TOKEN_A });
    render(<VaultPage store={store} />);
    await settle(() => screen.queryByText("ghp_…1111") !== null);
    await act(async () => {
      await store.vault.restore(token, TOKEN_B);
      store.secrets.update(token.id, {});
    });
    await settle(() => screen.queryByText("glpat-…2222") !== null);
    expect(screen.queryByText("ghp_…1111")).toBeNull();
  });
});
