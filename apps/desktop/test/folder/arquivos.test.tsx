import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { liveScreen, registerDom } from "../dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "../fixtures.ts";
import { settleMaybe } from "../wait.ts";

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
const { AppStore } = await import("../../src/lib/app-store.ts");
const { FolderPicker } = await import("../../src/features/hosts/folder-picker.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

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
  await store.roster.add({ name: "pc", url: d.listen().url, token: TOKEN });
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

// #4458: in file mode the dialog spoke only of folders, called a folder with files empty, and showed
// a refused file read as no files.
describe("pasta-arquivos: what the picker says in file mode (#4458)", () => {
  type Files =
    | { files: Array<{ name: string; path: string }>; truncated?: boolean }
    | "refused"
    | "pending";

  /** The picker on a stub host with one root, "/work", whose files answer as scripted. */
  async function stubbed(
    files: boolean,
    scripted: Files | Files[],
    language: "en" | "pt-BR" = "en",
    subdirs: string[] = [],
    /** Folders whose listing the host refuses. */
    refused: string[] = [],
  ) {
    const answers = Array.isArray(scripted) ? scripted : [scripted];
    let reads = 0;
    const { translator } = await import("../../src/i18n/index.ts");
    const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    store.hostRequest = (async (_host: string, type: string, payload: { path?: string }) => {
      if (type === "fs.dirs") {
        if (payload.path && refused.includes(payload.path)) {
          return { ok: false, code: "internal", message: "refused" };
        }
        return payload.path === undefined
          ? {
              ok: true,
              data: {
                path: null,
                parent: null,
                dirs: [{ name: "work", path: "/work" }],
                truncated: false,
              },
            }
          : {
              ok: true,
              data: {
                path: "/work",
                parent: null,
                dirs: subdirs.map((name) => ({ name, path: `/work/${name}` })),
                truncated: false,
              },
            };
      }
      const answer = answers[Math.min(reads++, answers.length - 1)] as Files;
      if (answer === "pending") return new Promise(() => {});
      if (answer === "refused") return { ok: false, code: "internal", message: "no files" };
      return { ok: true, data: { path: "/work", truncated: false, ...answer } };
    }) as never;
    const host = {
      id: "h",
      name: "pc",
      url: "wss://example.test",
      info: { allowedRoots: ["/work"] },
    } as never;
    render(
      <TContext.Provider value={translator(language)}>
        <FolderPicker
          store={store}
          host={host}
          files={files}
          onPick={() => {}}
          onClose={() => {}}
        />
      </TContext.Provider>,
    );
    await press("work");
  }
  const said = (text: string) => screen.queryByText(text) !== null;
  const NOTHING = "Nothing here: no subfolders and no files.";
  const FAILED = "The files of this folder could not be read.";

  test("a folder with files and no subfolders does not say there are no subfolders", async () => {
    await stubbed(true, { files: [{ name: "a.txt", path: "/work/a.txt" }] });
    expect(
      await settleMaybe(() => dialog().queryByRole("button", { name: "a.txt" }) !== null, 1500),
    ).toBe(true);
    expect(said("No subfolders here.")).toBe(false);
    expect(said(NOTHING)).toBe(false);
  });

  test("a folder with nothing in it says nothing is here", async () => {
    await stubbed(true, { files: [] });
    expect(await settleMaybe(() => said(NOTHING), 1500)).toBe(true);
    expect(said("No subfolders here.")).toBe(false);
  });

  test("a refused file read says the files could not be read, not that the folder is empty", async () => {
    await stubbed(true, "refused");
    expect(await settleMaybe(() => said(FAILED), 1500)).toBe(true);
    expect(said(NOTHING)).toBe(false);
  });

  test("more files than the host sends at once says so", async () => {
    await stubbed(true, { files: [{ name: "a.txt", path: "/work/a.txt" }], truncated: true });
    expect(
      await settleMaybe(
        () => said("Only the first 1 files are shown: type the path to go further."),
        1500,
      ),
    ).toBe(true);
  });

  test("the title, the list and the hidden checkbox name files too", async () => {
    await stubbed(true, { files: [] });
    expect(
      await settleMaybe(
        () => screen.queryByRole("dialog", { name: "Choose file or folder" }) !== null,
        1500,
      ),
    ).toBe(true);
    expect(dialog().queryByRole("list", { name: "Folders and files" }) !== null).toBe(true);
    expect(dialog().queryByLabelText("Show hidden folders and files") !== null).toBe(true);
  });

  test("the folder-only picker keeps its words", async () => {
    await stubbed(false, { files: [] });
    expect(await settleMaybe(() => said("No subfolders here."), 1500)).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Choose folder" }) !== null).toBe(true);
    expect(dialog().queryByRole("list", { name: "Folders" }) !== null).toBe(true);
    expect(dialog().queryByLabelText("Show hidden folders") !== null).toBe(true);
    expect(said(NOTHING)).toBe(false);
  });

  test("the folders show at once while the files are still being read", async () => {
    await stubbed(true, "pending", "en", ["sub"]);
    expect(
      await settleMaybe(() => dialog().queryByRole("button", { name: "sub" }) !== null, 1500),
    ).toBe(true);
    expect(said("Loading files…")).toBe(true);
    expect(said(NOTHING)).toBe(false);
  });

  test("a refused file read offers Try again, which reads the files again", async () => {
    await stubbed(true, ["refused", { files: [{ name: "a.txt", path: "/work/a.txt" }] }]);
    expect(await settleMaybe(() => said(FAILED), 1500)).toBe(true);
    await press("Try again");
    expect(
      await settleMaybe(() => dialog().queryByRole("button", { name: "a.txt" }) !== null, 1500),
    ).toBe(true);
    expect(said(FAILED)).toBe(false);
    expect(dialog().queryByRole("button", { name: "Try again" }) === null).toBe(true);
  });

  test("a refused folder while the files load does not leave Loading files on the screen for good", async () => {
    await stubbed(true, "pending", "en", ["sub"], ["/work/sub"]);
    expect(await settleMaybe(() => said("Loading files…"), 1500)).toBe(true);
    await press("sub");
    expect(
      await settleMaybe(() => dialog().queryByRole("button", { name: "Try again" }) !== null, 1500),
    ).toBe(true);
    expect(said("Loading files…")).toBe(false);
    expect(dialog().queryByRole("button", { name: "Try again" }) !== null).toBe(true);
  });

  test("after Try again the focus moves to the first entry of the list, not to the page", async () => {
    await stubbed(true, ["refused", { files: [{ name: "a.txt", path: "/work/a.txt" }] }]);
    expect(await settleMaybe(() => said(FAILED), 1500)).toBe(true);
    await press("Try again");
    expect(
      await settleMaybe(() => dialog().queryByRole("button", { name: "a.txt" }) !== null, 1500),
    ).toBe(true);
    expect(document.activeElement === dialog().queryByRole("button", { name: "a.txt" })).toBe(true);
  });

  test("a slow Try again of one folder does not freeze the failure row of the next folder", async () => {
    await stubbed(true, ["refused", "pending", "refused"], "en", ["sub"]);
    expect(await settleMaybe(() => said(FAILED), 1500)).toBe(true);
    await press("Try again");
    await press("sub");
    expect(await settleMaybe(() => said(FAILED), 1500)).toBe(true);
    expect(said("Loading files…")).toBe(false);
  });

  test("in Portuguese the file mode speaks Portuguese", async () => {
    await stubbed(true, "refused", "pt-BR");
    expect(
      await settleMaybe(() => said("Não foi possível ler os arquivos desta pasta."), 1500),
    ).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Escolher arquivo ou pasta" }) !== null).toBe(true);
  });
});
