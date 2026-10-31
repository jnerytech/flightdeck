import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { personasHost } from "./personas-ui-setup.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { NewSessionForm } = await import("../src/ui/NewSessionForm.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}
const fill = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
  await act(() => Bun.sleep(30));
};
const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

/** The app in English on a real daemon with the pack's personas, on "+ New session". */
async function open() {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await personasHost(cleanups, store);
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("personas") === true);
  await act(async () => {
    store.router.push({ name: "new-session", host: h.hostId });
  });
  await settle(() => screen.queryByLabelText("Persona") !== null);
  return { store, ...h };
}

describe("nova-sessao-ux: the persona chosen is the persona the session is in", () => {
  test("choosing Architect opens the session in it, and the session says so", async () => {
    const { d } = await open();
    await settle(() =>
      [...((screen.queryByLabelText("Persona") as HTMLSelectElement).options ?? [])].some(
        (o) => o.textContent === "Architect",
      ),
    );
    await fill("Persona", "host:arquiteto");
    await fill("First prompt", "desenhe o módulo");
    await press("Create session");
    await poll(() => d.manager.list().length === 1);
    expect(d.manager.list()[0]?.persona).toMatchObject({ id: "arquiteto", name: "Architect" });
    // The session's own screen shows the persona it runs in, and offers to leave it.
    await settle(() => screen.queryByLabelText("Active persona") !== null);
    expect(screen.queryByLabelText("Active persona")?.textContent ?? "").toContain("Architect");
    expect(screen.queryByRole("button", { name: "Back to normal" })).not.toBeNull();
  });

  test("a session opened with no persona shows none", async () => {
    const { d } = await open();
    await fill("First prompt", "oi");
    await press("Create session");
    await poll(() => d.manager.list().length === 1);
    await settle(() => screen.queryByRole("button", { name: "Apply" }) !== null);
    expect(screen.queryByLabelText("Active persona")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to normal" })).toBeNull();
  });
});

describe("nova-sessao-ux: the form says what it needs", () => {
  const host = {
    id: "h1",
    name: "pc",
    info: { allowedRoots: ["/work"] },
  } as unknown as Parameters<typeof NewSessionForm>[0]["host"];

  test("without a first prompt the button is off and says why; typing one turns it on", async () => {
    const created: unknown[] = [];
    const { TContext } = await import("../src/i18n/context.tsx");
    const { translator } = await import("../src/i18n/index.ts");
    render(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm host={host} onCreate={(payload) => void created.push(payload)} />
      </TContext.Provider>,
    );
    const button = () =>
      screen.queryByRole("button", { name: "Create session" }) as HTMLButtonElement | null;
    expect(button()?.disabled).toBe(true);
    expect(screen.queryByText("Write the first prompt to create the session")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "New session on pc" })).not.toBeNull();
    await fill("First prompt", "   ");
    expect(button()?.disabled).toBe(true);
    await fill("First prompt", "faça isto");
    expect(button()?.disabled).toBe(false);
    expect(screen.queryByText("Write the first prompt to create the session")).toBeNull();
    await press("Create session");
    expect(created).toEqual([{ cwd: "/work", prompt: "faça isto", permissionMode: "default" }]);
  });

  test("while the session is being created the button is busy and a second click creates nothing", async () => {
    const created: unknown[] = [];
    let open: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { TContext } = await import("../src/i18n/context.tsx");
    const { translator } = await import("../src/i18n/index.ts");
    render(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm
          host={host}
          onCreate={(payload) => {
            created.push(payload);
            return slow;
          }}
        />
      </TContext.Provider>,
    );
    await fill("First prompt", "faça isto");
    await press("Create session");
    expect(
      screen.queryByRole("button", { name: /Create session/ })?.getAttribute("aria-busy"),
    ).toBe("true");
    await press("Create session");
    expect(created).toHaveLength(1);
    open();
    await act(() => Bun.sleep(20));
    expect(
      screen.queryByRole("button", { name: /Create session/ })?.getAttribute("aria-busy"),
    ).toBeNull();
  });

  test("a host with no allowed folder says so instead of a silent button", async () => {
    const { TContext } = await import("../src/i18n/context.tsx");
    const { translator } = await import("../src/i18n/index.ts");
    const empty = { id: "h2", name: "vazio", info: { allowedRoots: [] } } as unknown as typeof host;
    render(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm host={empty} onCreate={() => {}} />
      </TContext.Provider>,
    );
    await fill("First prompt", "faça isto");
    expect(
      (screen.queryByRole("button", { name: "Create session" }) as HTMLButtonElement | null)
        ?.disabled,
    ).toBe(true);
    expect(
      screen.queryByText("This host has no allowed folder: add one in its settings"),
    ).not.toBeNull();
  });
});
