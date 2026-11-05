import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { FolderPicker } = await import("../src/ui/FolderPicker.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

async function setup(files: boolean) {
  const d = makeDaemon(cleanups);
  mkdirSync(join(d.root, "alfa"), { recursive: true });
  writeFileSync(join(d.root, "arquivo.txt"), "x");
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  await waitFor(() => expect(store.getState().hosts[0]?.status).toBe("online"));
  const host = store.getState().hosts[0];
  const picked: string[] = [];
  render(
    <TContext.Provider value={store.i18n.t}>
      <FolderPicker
        store={store}
        host={host as NonNullable<typeof host>}
        files={files}
        onPick={(path) => void picked.push(path)}
        onClose={() => {}}
      />
    </TContext.Provider>,
  );
  return { ...d, picked };
}

const dialog = () => within(screen.queryByRole("dialog") as HTMLElement);
const press = async (name: string | RegExp) => {
  await waitFor(() => expect(dialog().queryByRole("button", { name })).not.toBeNull());
  await act(async () => {
    fireEvent.click(dialog().queryByRole("button", { name }) as HTMLElement);
  });
};

describe("pasta-arquivos: a file of the host as well as a folder", () => {
  test("with files on, the files of the open folder are listed and one is picked by its path", async () => {
    const { root, picked } = await setup(true);
    await press(basename(root));
    await press("arquivo.txt");
    expect(picked).toEqual([join(root, "arquivo.txt")]);
  });

  test("without it, a folder shows no files", async () => {
    const { root } = await setup(false);
    await press(basename(root));
    await press("alfa");
    expect(dialog().queryByRole("button", { name: "arquivo.txt" })).toBeNull();
  });
});
