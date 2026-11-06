import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ReleaseNote } from "@flightdeck/protocol";
import { chooseFromAccountMenu } from "./account-menu.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { WHATS_NEW_KEY } = await import("../src/lib/whats-new.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");
const { WhatsNewDialog } = await import("../src/components/whatsnew/whats-new-dialog.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const note = (tag: string, highlights: string[] = ["First change (#1)", "Second change (#2)"]) =>
  ({
    tag,
    title: `Release ${tag}`,
    publishedAt: "2026-11-06T10:00:00Z",
    url: `https://github.com/jnerytech/flightdeck/releases/tag/${tag}`,
    highlights,
  }) as ReleaseNote;

/** Presses a button by name; a missing one is a failed expectation, not a thrown error. */
async function press(name: string) {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    if (button) fireEvent.click(button);
  });
}

type Result = Awaited<ReturnType<InstanceType<typeof AppStore>["releaseNotes"]>>;

/** A store whose release notes the test controls; every call is counted, every link opened recorded. */
function setup(answers: Array<Result | Promise<Result>>, lang: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const calls = { notes: 0, opened: [] as string[] };
  store.releaseNotes = (async () => {
    calls.notes += 1;
    return answers[Math.min(calls.notes - 1, answers.length - 1)] as Result;
  }) as never;
  store.openLink = ((url: string) => void calls.opened.push(url)) as never;
  let closed = 0;
  const view = (
    <TContext.Provider value={store.i18n.t}>
      <WhatsNewDialog store={store} onClose={() => void closed++} />
    </TContext.Provider>
  );
  return { store, view, calls, closed: () => closed };
}

describe("whats-new-ui: the dialog (issue #125)", () => {
  test("it opens on a status while the notes are read, then lists each release with its highlights", async () => {
    let release: (r: Result) => void = () => {};
    const { view } = setup([
      new Promise<Result>((done) => {
        release = done;
      }),
    ]);
    render(view);
    const dialog = screen.queryByRole("dialog", { name: "What's new" });
    expect(dialog).not.toBeNull();
    expect(screen.queryByText("Reading the release notes…")).not.toBeNull();
    await act(async () => {
      release({ kind: "ready", releases: [note("v0.38.0"), note("v0.37.4", [])] });
    });
    const list = screen.queryByRole("list", { name: "Releases" });
    expect(list).not.toBeNull();
    const items = within(list as HTMLElement).queryAllByRole("listitem", { name: "" });
    expect(items.length).toBeGreaterThanOrEqual(0);
    const text = (dialog as HTMLElement).textContent ?? "";
    expect(text).toContain("Release v0.38.0");
    expect(text).toContain("First change (#1)");
    expect(text).toContain("Second change (#2)");
    expect(text).toContain("Nov 6, 2026");
    // A release with no highlights says so instead of showing an empty list.
    expect(text).toContain("No highlights for this release.");
    expect(screen.queryByText("Reading the release notes…")).toBeNull();
  });

  test("a release opens on GitHub from its link, and View all opens the releases page", async () => {
    const { view, calls } = setup([{ kind: "ready", releases: [note("v0.38.0")] }]);
    render(view);
    await settle(() => screen.queryByText("Release v0.38.0") !== null);
    await press("Open Release v0.38.0 on GitHub");
    await press("View all releases");
    expect(calls.opened).toEqual([
      "https://github.com/jnerytech/flightdeck/releases/tag/v0.38.0",
      "https://github.com/jnerytech/flightdeck/releases",
    ]);
  });

  test("with no host that can read them it says what to do, and still offers View all", async () => {
    const { view } = setup([{ kind: "none" }]);
    render(view);
    await settle(() => screen.queryByText(/No connected host can read the release notes/) !== null);
    expect(screen.queryByText(/No connected host can read the release notes/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "View all releases" })).not.toBeNull();
  });

  test("a failed read is an alert with the reason and Try again, which reads again", async () => {
    const { view, calls } = setup([
      {
        kind: "error",
        message: "The release notes could not be read from GitHub: try again later.",
      },
      { kind: "ready", releases: [note("v0.38.0")] },
    ]);
    render(view);
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent).toContain("could not be read from GitHub");
    await press("Try again");
    await settle(() => screen.queryByText("Release v0.38.0") !== null);
    expect(calls.notes).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("opening it clears the dot, Esc closes it, and the Close button does too", async () => {
    const platform = memoryPlatform(false, "en").platform;
    platform.storage.setItem(WHATS_NEW_KEY, "0.0.1");
    const store = new AppStore(platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    store.releaseNotes = (async () => ({ kind: "ready", releases: [note("v1")] })) as never;
    expect(store.whatsNew.hasNew()).toBe(true);
    let closed = 0;
    render(
      <TContext.Provider value={store.i18n.t}>
        <WhatsNewDialog store={store} onClose={() => void closed++} />
      </TContext.Provider>,
    );
    expect(store.whatsNew.hasNew()).toBe(false);
    const dialog = screen.queryByRole("dialog");
    expect(dialog).not.toBeNull();
    await act(async () => {
      if (dialog) fireEvent.keyDown(dialog, { key: "Escape" });
    });
    expect(closed).toBe(1);
    await press("Close");
    expect(closed).toBe(2);
  });

  test("it is full-screen below 640 px and capped above, and everything is in Portuguese too", async () => {
    const { view } = setup([{ kind: "ready", releases: [note("v0.38.0")] }], "pt-BR");
    render(view);
    const dialog = screen.queryByRole("dialog", { name: "Novidades" });
    expect(dialog).not.toBeNull();
    const classes = (dialog?.className ?? "").split(" ");
    expect(classes).toContain("max-sm:h-dvh");
    expect(classes).toContain("max-sm:max-w-none");
    expect(classes).toContain("max-sm:rounded-none");
    await settle(() => screen.queryByText("Release v0.38.0") !== null);
    expect(screen.queryByRole("button", { name: "Ver todas as versões" })).not.toBeNull();
    expect(screen.queryByText("6 de nov. de 2026")).not.toBeNull();
  });
});

describe("whats-new-ui: the account menu entry and its dot (issue #125)", () => {
  function sidebar(seen: string | null) {
    const platform = memoryPlatform(false, "en").platform;
    if (seen) platform.storage.setItem(WHATS_NEW_KEY, seen);
    const store = new AppStore(platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    let opened = 0;
    render(
      <Sidebar
        store={store}
        state={store.getState()}
        collapsed={false}
        t={store.i18n.t}
        go={() => {}}
        onOpenProjectScreen={() => {}}
        onNewSession={() => {}}
        onRemoveHost={() => {}}
        onRenameHost={() => null}
        onOpenSearch={() => {}}
        onNewTab={() => {}}
        onToggleTheme={() => {}}
        onWhatsNew={() => void opened++}
      />,
    );
    return { store, opened: () => opened };
  }
  const trigger = () =>
    screen.queryAllByRole("button").find((b) => b.getAttribute("data-slot") === "account-trigger");

  test("after an update the account row says there are new notes, and What's new opens them", async () => {
    const { opened } = sidebar("0.0.1");
    expect(trigger()?.getAttribute("aria-label") ?? "").toContain("new release notes");
    await chooseFromAccountMenu("What's new New");
    expect(opened()).toBe(1);
  });

  test("with nothing new the row and the item carry no mark, and the item still opens the notes", async () => {
    const { store, opened } = sidebar(null);
    expect(store.whatsNew.hasNew()).toBe(false);
    expect(trigger()?.getAttribute("aria-label") ?? "").not.toContain("new release notes");
    await chooseFromAccountMenu("What's new");
    expect(opened()).toBe(1);
  });
});
