import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { FolderPicker } = await import("../src/ui/FolderPicker.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";
const TEXT = {
  en: { noRoots: "This host allows no folders yet", loading: "Loading folders…", list: "Folders" },
  "pt-BR": {
    noRoots: "Este host ainda não permite nenhuma pasta",
    loading: "Carregando as pastas…",
    list: "Pastas",
  },
} as const;

type Listing = { path: string | null; parent: string | null; dirs: unknown[]; truncated: boolean };
const folders = (...names: string[]): Listing => ({
  path: "/r",
  parent: null,
  dirs: names.map((name) => ({ name, path: `/r/${name}` })),
  truncated: false,
});

/** The picker over a host whose `fs.dirs` answers come from `answer`, in call order. */
async function mount(
  lang: Lang,
  allowedRoots: string[],
  answer: (call: number) => Promise<unknown>,
) {
  const store = new AppStore(memoryPlatform(false, lang).platform);
  store.i18n.start();
  const asked: Array<string | undefined> = [];
  (store as unknown as Record<string, unknown>).hostRequest = async (
    _host: string,
    _method: string,
    params: { path?: string },
  ) => {
    asked.push(params.path);
    return answer(asked.length);
  };
  const host = { id: "h", name: "wsl", status: "online", url: "ws://x", info: { allowedRoots } };
  render(
    <TContext.Provider value={store.i18n.t}>
      <FolderPicker store={store} host={host as never} onPick={() => {}} onClose={() => {}} />
    </TContext.Provider>,
  );
  await act(async () => {});
  await act(async () => {});
  return { asked };
}

describe("sonar-regex2: the picker's status messages are <output> elements", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    test(`a host with no allowed folder says so in an <output> with role status (${lang})`, async () => {
      await mount(lang, [], async () => ({
        ok: true,
        data: { path: null, parent: null, dirs: [], truncated: false },
      }));
      const message = screen.queryByText(TEXT[lang].noRoots);
      expect(message).not.toBeNull();
      expect(message?.tagName).toBe("OUTPUT");
      const status = screen.queryAllByRole("status").filter((el) => el === message);
      expect(status.length).toBe(1); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    });

    test(`the loading message shows in an <output> with role status while a folder opens (${lang})`, async () => {
      await mount(lang, ["/r"], (call) =>
        call === 1
          ? Promise.resolve({ ok: true, data: folders("alfa") })
          : new Promise<never>(() => {}),
      );
      await act(async () => {
        fireEvent.click(screen.queryByRole("button", { name: "alfa" }) as HTMLElement);
      });
      const message = screen.queryByText(TEXT[lang].loading);
      expect(message).not.toBeNull();
      expect(message?.tagName).toBe("OUTPUT");
      expect(screen.queryAllByRole("status").filter((el) => el === message).length).toBe(1); // NOSONAR: the boolean keeps a DOM node out of the failure diff
      const list = screen.queryByRole("list", { name: TEXT[lang].list });
      expect(list?.getAttribute("aria-busy")).toBe("true");
    });
  }
});

describe("sonar-regex2: the folder list is driven from its buttons, in order, by the keyboard", () => {
  test("each folder is a button in the tab order; arrows move between them, Enter opens one, Backspace goes up", async () => {
    const { asked } = await mount("en", ["/r"], async (call) => ({
      ok: true,
      data: call === 1 ? folders("alfa", "beta") : { ...folders("inner"), parent: "/r" },
    }));
    const alfa = screen.queryByRole("button", { name: "alfa" }) as HTMLElement;
    const beta = screen.queryByRole("button", { name: "beta" }) as HTMLElement;
    expect([alfa.tagName, beta.tagName]).toEqual(["BUTTON", "BUTTON"]);
    expect([alfa.getAttribute("type"), beta.getAttribute("type")]).toEqual(["button", "button"]);
    expect([alfa.tabIndex, beta.tabIndex]).toEqual([0, 0]);
    expect(alfa.compareDocumentPosition(beta) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    alfa.focus();
    await act(async () => {
      fireEvent.keyDown(alfa, { key: "ArrowDown" });
    });
    expect(document.activeElement).toBe(beta);
    await act(async () => {
      fireEvent.keyDown(beta, { key: "ArrowUp" });
    });
    expect(document.activeElement).toBe(alfa);
    await act(async () => {
      fireEvent.keyDown(alfa, { key: "Enter" });
    });
    expect(asked.at(-1)).toBe("/r/alfa");
    expect(screen.queryByRole("button", { name: "inner" })).not.toBeNull();

    const inner = screen.queryByRole("button", { name: "inner" }) as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(inner, { key: "Backspace" });
    });
    expect(asked.at(-1)).toBe("/r");
  });
});
