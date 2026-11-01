import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { FsDirsResult } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

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
const { NewSessionForm } = await import("../src/ui/NewSessionForm.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

/** A host whose folders are Windows paths, answering `fs.dirs` from a table. */
const TREE: Record<string, FsDirsResult> = {
  "": {
    path: null,
    parent: null,
    dirs: [{ name: "code", path: "C:\\Users\\me\\code" }],
    truncated: false,
  },
  "C:\\Users\\me\\code": {
    path: "C:\\Users\\me\\code",
    parent: null,
    dirs: [{ name: "app", path: "C:\\Users\\me\\code\\app" }],
    truncated: false,
  },
  "C:\\Users\\me\\code\\app": {
    path: "C:\\Users\\me\\code\\app",
    parent: "C:\\Users\\me\\code",
    dirs: [],
    truncated: false,
  },
};

function windowsHost() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
  (store as unknown as { hostRequest: unknown }).hostRequest = async (
    _id: string,
    _type: string,
    payload: { path?: string },
  ) => ({ ok: true, data: TREE[payload.path ?? ""] });
  const host = {
    id: "h",
    name: "pc",
    url: "ws://127.0.0.1:1/v1/ws",
    status: "online",
    info: { allowedRoots: ["C:\\Users\\me\\code"] },
    hostInfo: { features: ["fs.dirs"] },
  };
  return { store, host };
}

const dialog = () => screen.queryByRole("dialog", { name: "Escolher pasta" });
const has = (name: string | RegExp) =>
  within(dialog() as HTMLElement).queryByRole("button", { name }) !== null;
async function press(name: string | RegExp) {
  await waitFor(() => expect(has(name)).toBe(true));
  await act(async () => {
    fireEvent.click(within(dialog() as HTMLElement).getByRole("button", { name }));
  });
}

describe("pasta: Windows paths", () => {
  test("the picker walks C:\\ paths: the breadcrumb names each folder, and choosing hands over the Windows path", async () => {
    const { store, host } = windowsHost();
    const picked: string[] = [];
    render(
      <TContext.Provider value={store.i18n.t}>
        <FolderPicker
          store={store}
          host={host as never}
          onPick={(path) => void picked.push(path)}
          onClose={() => {}}
        />
      </TContext.Provider>,
    );
    await press("code");
    await press("app");
    await waitFor(() =>
      expect(within(dialog() as HTMLElement).queryByText("Nenhuma subpasta aqui.") !== null).toBe(
        true,
      ),
    );
    // The crumb of the root is a button that goes back; the folder open now is plain text.
    expect(has("code")).toBe(true);
    expect(has("app")).toBe(false);
    await press("Escolher esta pasta");
    expect(picked).toEqual(["C:\\Users\\me\\code\\app"]);
  });

  test("Nova sessão splits a picked Windows path into the root and the subfolder, whatever its letters", async () => {
    const { store, host } = windowsHost();
    render(
      <TContext.Provider value={store.i18n.t}>
        <NewSessionForm host={host as never} store={store} onCreate={() => {}} />
      </TContext.Provider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Procurar…" }));
    });
    await press("code");
    await press("app");
    await press("Escolher esta pasta");
    expect((screen.getByLabelText("Pasta") as HTMLSelectElement).value).toBe("C:\\Users\\me\\code");
    expect((screen.getByLabelText("Subpasta") as HTMLInputElement).value).toBe("app");
  });
});
