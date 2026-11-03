import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { NewSessionForm } = await import("../src/ui/NewSessionForm.tsx");
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};
const press = (name: string) => click(screen.queryByRole("button", { name }));
const optionNames = (select: HTMLElement) =>
  [...(select as HTMLSelectElement).options].map((o) => o.textContent ?? "");

describe("bypass-ui: the host settings", () => {
  test("the host page shows the switch off, asks before turning it on, and turning it off asks nothing", async () => {
    const d = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id ?? "";
    await act(async () => store.router.push({ name: "host", host: hostId }));
    await settle(() => screen.queryByText("Sessions without permission prompts") !== null);
    expect(screen.queryByText("Off on this host.")).not.toBeNull();
    await press("Allow sessions without prompts");
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent ?? "").toContain("alfa");
    await click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(store.getState().hosts[0]?.hostInfo?.allowBypassPermissions).toBe(false);
    await press("Allow sessions without prompts");
    await click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Allow sessions without prompts",
      }),
    );
    await settle(() => store.getState().hosts[0]?.hostInfo?.allowBypassPermissions === true);
    await settle(
      () => screen.queryByText("On: sessions can run without permission prompts.") !== null,
    );
    await press("Turn off");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await settle(() => store.getState().hosts[0]?.hostInfo?.allowBypassPermissions === false);
  });
});

describe("bypass-ui: the New session form", () => {
  const form = (allow: boolean | undefined, created: unknown[]) => {
    const host = {
      id: "h1",
      name: "pc",
      info: { allowedRoots: ["/work"] },
      hostInfo: allow === undefined ? {} : { allowBypassPermissions: allow },
    } as unknown as Parameters<typeof NewSessionForm>[0]["host"];
    render(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm host={host} onCreate={(payload) => void created.push(payload)} />
      </TContext.Provider>,
    );
  };
  const fillPrompt = async () => {
    await act(async () => {
      fireEvent.change(screen.getByLabelText("First prompt"), { target: { value: "go" } });
    });
  };

  test("the bypass mode is offered only on a host that allows it", () => {
    form(false, []);
    expect(optionNames(screen.getByLabelText("Permission mode")).join("|")).not.toContain("Bypass");
    cleanup();
    form(undefined, []);
    expect(optionNames(screen.getByLabelText("Permission mode")).join("|")).not.toContain("Bypass");
    cleanup();
    form(true, []);
    expect(optionNames(screen.getByLabelText("Permission mode")).at(-1)).toBe(
      "Bypass permissions: no prompts",
    );
  });

  test("picking it asks every time, naming the host and the folder; only the confirm creates", async () => {
    const created: Array<{ permissionMode?: string }> = [];
    form(true, created);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Permission mode"), {
        target: { value: "bypassPermissions" },
      });
    });
    await fillPrompt();
    await press("Create session");
    let dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent ?? "").toContain("pc");
    expect(dialog.textContent ?? "").toContain("/work");
    await click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(created).toEqual([]);
    await press("Create session");
    dialog = screen.getByRole("alertdialog");
    await click(within(dialog).getByRole("button", { name: "Start without prompts" }));
    expect(created.map((c) => c.permissionMode)).toEqual(["bypassPermissions"]);
  });

  test("another mode creates at once, with no dialog", async () => {
    const created: unknown[] = [];
    form(true, created);
    await fillPrompt();
    await press("Create session");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(created).toHaveLength(1);
  });
});

describe("bypass-ui: the open session", () => {
  const view = (bypass: { host: string } | undefined, calls: string[], start = "plan") => {
    render(
      <SessionView
        title="refactor"
        t={translator("en")}
        session={{ ...emptySession(), status: "idle", permissionMode: start as never }}
        actions={{
          send: async () => {},
          interrupt: async () => {},
          close: async () => {},
          resume: async () => {},
          respond: async () => {},
          setMode: async (mode) => void calls.push(mode),
        }}
        settings
        {...(bypass ? { bypass } : {})}
      />,
    );
  };
  const select = () => screen.getByLabelText("Permission mode");

  test("a host that does not allow it offers what it did: nothing looser than the start mode", () => {
    view(undefined, []);
    expect(optionNames(select())).toEqual(["Plan"]);
  });

  test("a host that allows it offers every mode, bypass included, even from plan", () => {
    view({ host: "pc" }, []);
    expect(optionNames(select())).toEqual([
      "Plan",
      "Default",
      "Accept edits",
      "Bypass permissions",
    ]);
  });

  test("bypass asks each time, naming the host and the session; Cancel leaves the mode as it was", async () => {
    const calls: string[] = [];
    view({ host: "pc" }, calls);
    await act(async () => {
      fireEvent.change(select(), { target: { value: "bypassPermissions" } });
    });
    let dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent ?? "").toContain("pc");
    expect(dialog.textContent ?? "").toContain("refactor");
    await click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);
    expect((select() as HTMLSelectElement).value).toBe("plan");
    await act(async () => {
      fireEvent.change(select(), { target: { value: "bypassPermissions" } });
    });
    dialog = screen.getByRole("alertdialog");
    await click(within(dialog).getByRole("button", { name: "Switch to bypass" }));
    expect(calls).toEqual(["bypassPermissions"]);
    expect((select() as HTMLSelectElement).value).toBe("bypassPermissions");
  });

  test("any other mode changes at once, with no dialog", async () => {
    const calls: string[] = [];
    view({ host: "pc" }, calls);
    await act(async () => {
      fireEvent.change(select(), { target: { value: "acceptEdits" } });
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls).toEqual(["acceptEdits"]);
  });
});

describe("bypass-ui: end to end", () => {
  test("with the host switch on, a session created in bypass is stored in that mode", async () => {
    const d = makeDaemon(cleanups, { bypass: true });
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.hostInfo?.allowBypassPermissions === true);
    const hostId = store.getState().hosts[0]?.id ?? "";
    await act(async () => store.router.push({ name: "new-session", host: hostId }));
    await settle(() => screen.queryByLabelText("Permission mode") !== null);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Permission mode"), {
        target: { value: "bypassPermissions" },
      });
      fireEvent.change(screen.getByLabelText("First prompt"), { target: { value: "go" } });
    });
    await press("Create session");
    await click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Start without prompts",
      }),
    );
    await poll(() => d.manager.list().length === 1);
    expect(d.manager.list()[0]?.permissionMode).toBe("bypassPermissions");
  });
});
