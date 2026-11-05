import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, waitFor as pollFor, TOKEN } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(60_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const WAIT = { timeout: 20_000 };
const realTempFolder = () => join(tmpdir(), `fd-simple-${crypto.randomUUID()}`);
/** The control may take a moment: the host answers, then the screen draws. */
const click = async (name: string | RegExp) => {
  const button = await waitFor(() => screen.getByRole("button", { name }), WAIT);
  await act(async () => {
    fireEvent.click(button);
  });
};
const nav = () => screen.getByRole("navigation", { name: "Simple mode" });
const chip = (text: string) =>
  waitFor(() => screen.getByText(text, { selector: "[data-slot='task-chip']" }), WAIT);

/** Simple mode on a local host: a task from a template, through to its files, and the way out. */
describe("simple-app-flow: the container, end to end on a fake host", () => {
  test("Given Home, When a task is started and answered, Then it runs, shows its files, opens them and can be stopped", async () => {
    const opened: string[] = [];
    const mem = memoryPlatform(false, "en");
    mem.platform.openPath = async (path) => void opened.push(`open:${path}`);
    mem.platform.revealPath = async (path) => void opened.push(`reveal:${path}`);
    let picked = "";
    mem.platform.pickFolder = async () => picked;
    const d = makeDaemon(cleanups, { simple: true, ui: { mode: "simple", locked: false } });
    const server = d.listen();
    const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    const hostId = await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
    await pollFor(() => store.getState().hosts.find((h) => h.id === hostId)?.hostInfo, "host info");

    // Start a task from a card.
    const folder = join(d.root, "notes");
    mkdirSync(folder, { recursive: true });
    picked = folder;
    await click(/Summarise a folder/);
    await click("Choose folder…");
    await waitFor(() =>
      expect(
        (within(screen.getByRole("dialog")).getAllByRole("textbox")[0] as HTMLInputElement).value,
      ).toBe(folder),
    );
    await click("Start this task");
    await chip("Done");

    // It made a file; asking for changes runs another turn, and the files are asked for again.
    const result = join(folder, "Flightdeck results", "summary.md");
    writeFileSync(result, "# Summary\n- one\n");
    writeFileSync(join(folder, "Flightdeck results", "extra.md"), "# Extra\n");
    fireEvent.change(
      await waitFor(() => screen.getByRole("textbox", { name: "Ask for changes" }), WAIT),
      {
        target: { value: "make it shorter" },
      },
    );
    await click("Send");
    await chip("Done");
    await waitFor(() => screen.getByText("summary.md"), WAIT);

    // Preview, open and show it from the task.
    await click("Open summary.md");
    const preview = await waitFor(
      () => screen.getByRole("region", { name: "Preview of summary.md" }),
      WAIT,
    );
    await act(async () => {
      fireEvent.click(within(preview).getByRole("button", { name: "Open summary.md" }));
    });
    await click("Show summary.md in its folder");
    await waitFor(() => expect(opened).toEqual([`open:${result}`, `reveal:${result}`]));

    // A question, answered; then another, and the task is stopped.
    fireEvent.change(
      await waitFor(() => screen.getByRole("textbox", { name: "Ask for changes" }), WAIT),
      {
        target: { value: "[tool] add a title" },
      },
    );
    await click("Send");
    await chip("Waiting for your answer");
    await click("Yes, go ahead");
    await chip("Done");
    fireEvent.change(
      await waitFor(() => screen.getByRole("textbox", { name: "Ask for changes" }), WAIT),
      {
        target: { value: "[tool] once more" },
      },
    );
    await click("Send");
    await chip("Waiting for your answer");
    await click("Stop the task");
    await chip("Stopped");

    // Back to Home, the recent task opens, and Files lists what it made.
    await click("Back");
    await click(/^Open Summarise a folder/);
    await click("Back");
    await act(async () => {
      fireEvent.click(within(nav()).getByRole("button", { name: "Files" }));
    });
    await waitFor(() => screen.getByText("summary.md"));
    await click("Open summary.md");
    await click("Show summary.md in its folder");
    await waitFor(() => expect(opened).toHaveLength(4));

    // A second task: Home lists both, newest first.
    await act(async () => {
      fireEvent.click(within(nav()).getByRole("button", { name: "Home" }));
    });
    await click(/^Summarise a folder/);
    await click("Choose folder…");
    await click("Start this task");
    await chip("Done");
    await click("Back");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Open Summarise a folder/ })).toHaveLength(2),
    );

    // Settings: the language changes at once.
    await act(async () => {
      fireEvent.click(within(nav()).getByRole("button", { name: "Settings" }));
    });
    await act(async () => {
      fireEvent.change(
        await waitFor(() => screen.getByRole("combobox", { name: "Language" }), WAIT),
        {
          target: { value: "pt-BR" },
        },
      );
    });
    await waitFor(() => expect(store.i18n.lang).toBe("pt-BR"));
  });

  test("Given a task that fails, When Try again and Show details are pressed, Then it runs again and the full session opens", async () => {
    const d = makeDaemon(cleanups, { simple: true, ui: { mode: "simple", locked: false } });
    const server = d.listen();
    const store = new AppStore(memoryPlatform(false, "en").platform, {
      baseDelayMs: 10,
      maxDelayMs: 20,
    });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    const hostId = await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
    await pollFor(() => store.getState().hosts.find((h) => h.id === hostId)?.hostInfo, "host info");
    const folder = join(d.root, "notes");
    mkdirSync(folder, { recursive: true });
    await click(/Summarise a folder/);
    fireEvent.change(
      within(await waitFor(() => screen.getByRole("dialog"), WAIT)).getAllByRole(
        "textbox",
      )[0] as HTMLElement,
      {
        target: { value: folder },
      },
    );
    await click("Start this task");
    await chip("Done");
    fireEvent.change(
      await waitFor(() => screen.getByRole("textbox", { name: "Ask for changes" }), WAIT),
      {
        target: { value: "[fail] now" },
      },
    );
    await click("Send");
    await chip("Could not finish");
    await click("Try again");
    await chip("Could not finish");
    await click("Show details");
    await waitFor(() => expect(store.uiMode(hostId).mode).toBe("full"));
    expect(store.router.current.name).toBe("session");
  });

  test("Given Settings, When the theme, a folder, notifications and Show everything are used, Then each reaches the app and the host", async () => {
    const mem = memoryPlatform(false, "en");
    const extra = join(realTempFolder(), "more");
    mkdirSync(extra, { recursive: true });
    mem.platform.pickFolder = async () => extra;
    const d = makeDaemon(cleanups, { simple: true, ui: { mode: "simple", locked: false } });
    const server = d.listen();
    const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    const hostId = await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
    await pollFor(() => store.getState().hosts.find((h) => h.id === hostId)?.hostInfo, "host info");
    await act(async () => {
      fireEvent.click(within(nav()).getByRole("button", { name: "Settings" }));
    });

    await act(async () => {
      fireEvent.change(await waitFor(() => screen.getByRole("combobox", { name: "Theme" }), WAIT), {
        target: { value: "dark" },
      });
    });
    expect(store.theme.mode).toBe("dark");

    // Choose a folder, then add it: the host lists it among the folders tasks may use.
    await click("Choose folder…");
    await waitFor(
      () =>
        expect(
          (screen.getByRole("textbox", { name: "Folder to add" }) as HTMLInputElement).value,
        ).toBe(extra),
      WAIT,
    );
    await click("Add folder");
    await waitFor(() => expect(document.body.textContent?.includes(extra)).toBe(true), WAIT);

    const tell = screen.getByRole("checkbox", { name: /Tell me when a task needs my answer/ });
    await act(async () => {
      fireEvent.click(tell);
    });
    await waitFor(() => expect(store.getState().settings.notifyUpdates).toBe(false));

    // Show everything asks first; Cancel keeps Simple mode, the second time it leaves.
    await click("Show everything");
    await click("Cancel");
    expect(store.uiMode(hostId).mode).toBe("simple");
    await click("Show everything");
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Show everything" }),
      );
    });
    await waitFor(() => expect(store.uiMode(hostId).mode).toBe("full"));
  });
});
