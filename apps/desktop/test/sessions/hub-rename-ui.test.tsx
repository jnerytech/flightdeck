import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settleMaybe, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { SessionsHub } = await import("../../src/features/sessions/sessions-hub.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #2673: Rename in the sessions hub opens a small form, not a bare field. Focus goes to the
 * field with the current name selected, Enter saves, Escape or Cancel closes it, and focus comes
 * back to the row's actions button.
 */
function setup() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
  const saved: Array<{ id: string; name: string | null | undefined }> = [];
  store.sessionLists.setMeta = async (_host, id, patch) => {
    saved.push({ id, name: patch.name });
  };
  const history = [1, 2].map((n) => ({
    claudeSessionId: `c${n}`,
    cwd: "/work/p",
    projectKey: "host:h1:/work/p",
    title: `session ${n}`,
    summary: null,
    lastTs: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    firstTs: null,
    messageCount: 3,
  }));
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "h1",
        url: "ws://x",
        token: "",
        status: "online",
        info: null,
        hostInfo: null,
        incompatibility: null,
        daemonUpdate: null,
        sessions: [],
      },
    ],
    hub: { h1: { managed: [], history } },
  };
  render(
    <TooltipProvider>
      <SessionsHub
        store={store}
        state={state as never as ReturnType<typeof store.getState>}
        onOpen={() => {}}
        isOpen={() => false}
        density="comfortable"
      />
    </TooltipProvider>,
  );
  return { saved };
}

const actionsOf = (title: string) =>
  screen.queryByRole("button", { name: `Ações de ${title}` }) as HTMLElement;

/** Opens the project (a search matching every title), then the row's menu, then picks Rename. */
async function startRename(title: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Filtrar sessões"), { target: { value: "session" } });
  });
  await uiIdle();
  await settleMaybe(() => actionsOf(title) !== null, 1500);
  expect(actionsOf(title)).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(actionsOf(title), { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Renomear" }));
  });
  await uiIdle();
}

const field = (title: string) =>
  screen.queryByRole("textbox", { name: `Nome de ${title}` }) as HTMLInputElement | null;

describe("hub-rename: Rename is a form with focus handling (#2673)", () => {
  test("Rename opens a form named after the session, focus in the field and its name selected", async () => {
    setup();
    await startRename("session 1");
    await settleMaybe(() => field("session 1") !== null, 1500);
    const input = field("session 1");
    expect(input).not.toBeNull();
    const form = input?.closest("form") ?? null;
    expect([
      document.activeElement === input,
      input?.selectionStart === 0 && input?.selectionEnd === input?.value.length,
      input?.value,
      form?.contains(screen.queryByRole("button", { name: "Salvar nome" })) ?? false,
      form?.contains(screen.queryByRole("button", { name: "Cancelar" })) ?? false,
    ]).toEqual([true, true, "session 1", true, true]);
  });

  test("submitting the form saves the trimmed name and focus returns to the row's actions button", async () => {
    const { saved } = setup();
    await startRename("session 1");
    await settleMaybe(() => field("session 1") !== null, 1500);
    expect(field("session 1")).not.toBeNull();
    const input = field("session 1") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "  Servidor  " } });
    });
    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });
    await settleMaybe(() => field("session 1") === null, 1500);
    expect([
      saved,
      field("session 1") === null,
      document.activeElement === actionsOf("session 1"),
    ]).toEqual([[{ id: "c1", name: "Servidor" }], true, true]);
  });

  test("Escape closes the form without saving and focus returns to the row's actions button", async () => {
    const { saved } = setup();
    await startRename("session 2");
    await settleMaybe(() => field("session 2") !== null, 1500);
    expect(field("session 2")).not.toBeNull();
    const input = field("session 2") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "other" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });
    await settleMaybe(() => field("session 2") === null, 1500);
    expect([
      saved,
      field("session 2") === null,
      document.activeElement === actionsOf("session 2"),
    ]).toEqual([[], true, true]);
  });

  test("the Cancel button closes the form without saving", async () => {
    const { saved } = setup();
    await startRename("session 1");
    await settleMaybe(() => field("session 1") !== null, 1500);
    const cancel = screen.queryByRole("button", { name: "Cancelar" });
    expect(cancel).not.toBeNull();
    await act(async () => {
      fireEvent.click(cancel as HTMLElement);
    });
    await settleMaybe(() => field("session 1") === null, 1500);
    expect([
      saved,
      field("session 1") === null,
      document.activeElement === actionsOf("session 1"),
    ]).toEqual([[], true, true]);
  });

  test("another row's menu, opened and closed while the form is open, gives the focus back to its own button", async () => {
    setup();
    await startRename("session 1");
    await settleMaybe(() => field("session 1") !== null, 1500);
    await act(async () => {
      fireEvent.pointerDown(actionsOf("session 2"), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    const items = screen.queryAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.keyDown(items[0] as HTMLElement, { key: "Escape" });
    });
    await uiIdle();
    expect(document.activeElement === actionsOf("session 2")).toBe(true);
  });
});
