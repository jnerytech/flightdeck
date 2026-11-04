import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { FolderPicker } = await import("../src/ui/FolderPicker.tsx");
const { ActionButton } = await import("../src/components/feedback/action-button.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

afterEach(cleanup);

describe("pasta-sem-raiz: a host that allows no folder says so and offers to add one", () => {
  test("the dialog names the dead end and adds a folder to the host's allowed ones", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    const asked: string[] = [];
    (store as unknown as Record<string, unknown>).hostRequest = async () => ({
      ok: true,
      data: { path: null, dirs: [], truncated: false },
    });
    (store as unknown as Record<string, unknown>).allowRoot = async (
      host: string,
      path: string,
    ) => {
      asked.push(`${host}:${path}`);
      return true;
    };
    const host = {
      id: "h",
      name: "wsl",
      status: "online",
      url: "ws://x",
      info: { allowedRoots: [] },
    };
    render(
      <TContext.Provider value={store.i18n.t}>
        <FolderPicker store={store} host={host as never} onPick={() => {}} onClose={() => {}} />
      </TContext.Provider>,
    );
    await act(async () => {});
    await act(async () => {});
    expect(screen.queryByText("Este host ainda não permite nenhuma pasta")).not.toBeNull();
    expect(screen.queryByText("Nenhuma subpasta aqui.")).toBeNull();
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Pasta a permitir") as HTMLElement, {
        target: { value: "/home/u/work" },
      });
    });
    await act(async () => {
      fireEvent.click(
        screen.queryByRole("button", { name: "Adicionar às pastas permitidas" }) as HTMLElement,
      );
    });
    const confirm = screen.queryAllByRole("button", { name: "Adicionar às pastas permitidas" });
    await act(async () => {
      fireEvent.click(confirm.at(-1) as HTMLElement);
    });
    expect(asked).toEqual(["h:/home/u/work"]);
  });

  test("a disabled button's reason sits under it in one block, not as a column beside it", () => {
    render(
      <ActionButton disabled disabledReason="Abra uma pasta antes">
        Escolher
      </ActionButton>,
    );
    const button = screen.queryByRole("button", { name: "Escolher" }) as HTMLElement;
    const reason = screen.queryByText("Abra uma pasta antes") as HTMLElement;
    expect(reason.parentElement).toBe(button.parentElement);
    expect(button.parentElement?.className).toContain("action-button-box");
    expect(reason.className).toContain("action-reason");
  });
});
