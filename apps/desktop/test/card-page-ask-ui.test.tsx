import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { CardFields } = await import("../src/components/card/card-fields.tsx");
const { CardRunForm } = await import("../src/components/card/card-run-form.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const card = (over: object = {}) =>
  ({
    id: "c1",
    projectId: "p1",
    title: "Cart screen",
    description: "no checklist here",
    column: "backlog",
    validationNote: null,
    sessionId: null,
    queued: false,
    worktreePath: null,
    ...over,
  }) as never;

const ASKING = {
  id: "p1",
  contractByColumn: { in_progress: { enforce: "confirm", checks: ["criteria"] } },
} as never;

type Call = [string, string, unknown];

function setup(options: { projects?: never[] } = {}) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  if (options.projects) store.rememberProjects("h1", options.projects);
  const commands: Call[] = [];
  const background: unknown[] = [];
  const requests: Call[] = [];
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    commands.push([hostId, type, payload]);
    return {};
  }) as never;
  store.hostRequest = (async (hostId: string, type: string, payload: unknown) => {
    // The project's validation template (#1058) is its own ask, covered by its own test.
    if (type === "card.validationTemplate") {
      return { ok: true, data: { text: null, ignored: null } };
    }
    requests.push([hostId, type, payload]);
    return { ok: true, data: {} };
  }) as never;
  store.startBackground = (async (_hostId: string, payload: unknown) => {
    background.push(payload);
    return true;
  }) as never;
  const t = store.i18n.t;
  const wrap = (child: React.ReactNode) => <TContext.Provider value={t}>{child}</TContext.Provider>;
  return { store, commands, requests, background, wrap };
}

const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });
/** Start in the background is under the card's menu (#1197). */
const startInBackground = async () => {
  await act(async () => {
    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for Cart screen" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
  await click(await screen.findByRole("menuitem", { name: "Start in the background" }));
};

describe("card-page-ask-ui: the validation note on the card page", () => {
  test("it is a labelled field whose Save sends the trimmed note, and empty text clears it", async () => {
    const w = setup();
    render(
      w.wrap(
        <CardFields
          store={w.store}
          hostId="h1"
          card={card()}
          withRoi={false}
          onOpenSettings={() => {}}
        />,
      ),
    );
    const field = screen.getByLabelText("Validation note");
    const save = () => screen.getByRole("button", { name: "Save validation note" });
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.change(field, { target: { value: "  Ran it by hand.  " } });
    });
    await click(save());
    await settle(() => w.commands.length === 1);
    expect(w.commands).toEqual([
      ["h1", "card.update", { cardId: "c1", validationNote: "Ran it by hand." }],
    ]);
  });

  test("a card that has a note shows it, and clearing it sends null", async () => {
    const w = setup();
    render(
      w.wrap(
        <CardFields
          store={w.store}
          hostId="h1"
          card={card({ validationNote: "Checked." })}
          withRoi={false}
          onOpenSettings={() => {}}
        />,
      ),
    );
    const field = screen.getByLabelText("Validation note") as HTMLTextAreaElement;
    expect(field.value).toBe("Checked.");
    await act(async () => {
      fireEvent.change(field, { target: { value: "" } });
    });
    await click(screen.getByRole("button", { name: "Save validation note" }));
    await settle(() => w.commands.length === 1);
    expect(w.commands).toEqual([["h1", "card.update", { cardId: "c1", validationNote: null }]]);
  });
});

function form(w: ReturnType<typeof setup>, cardOver: object = {}) {
  render(
    w.wrap(
      <CardRunForm
        store={w.store}
        hostId="h1"
        card={card(cardOver)}
        features={{ bg: true, watch: false }}
        tab="conversation"
        canMerge={false}
        gateWaiting={false}
        onMerge={() => {}}
        arenaStart={null}
        onDiscarded={() => {}}
        onShowDiff={() => {}}
      />,
    ),
  );
}
const starts = (w: ReturnType<typeof setup>) =>
  w.commands.filter(([, type]) => type === "card.start");
const ask = () => screen.queryByRole("alertdialog");

describe("card-page-ask-ui: Start asks only where In progress confirms criteria", () => {
  test("by default Start sends card.start at once", async () => {
    const w = setup();
    form(w);
    await click(screen.getByRole("button", { name: "Start" }));
    expect(ask() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    expect(starts(w)).toEqual([["h1", "card.start", { cardId: "c1" }]]);
  });

  test("where it confirms, a card with no criteria asks first: Cancel sends nothing, Start anyway starts it", async () => {
    const w = setup({ projects: [ASKING] });
    form(w);
    await click(screen.getByRole("button", { name: "Start" }));
    expect(ask()).not.toBeNull();
    expect((ask() as HTMLElement).textContent).toContain("Start Cart screen anyway?");
    await click(within(ask() as HTMLElement).getByRole("button", { name: "Cancel" }));
    expect(ask() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    expect(starts(w)).toEqual([]);
    await click(screen.getByRole("button", { name: "Start" }));
    await click(within(ask() as HTMLElement).getByRole("button", { name: "Start anyway" }));
    expect(starts(w)).toEqual([["h1", "card.start", { cardId: "c1" }]]);
  });

  test("a card with criteria starts at once even where it confirms", async () => {
    const w = setup({ projects: [ASKING] });
    form(w, { description: "Goal\n- [ ] it works" });
    await click(screen.getByRole("button", { name: "Start" }));
    expect(ask() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    expect(starts(w)).toHaveLength(1);
  });

  test("Start in the background follows the same rule", async () => {
    const w = setup({ projects: [ASKING] });
    form(w);
    await startInBackground();
    expect(ask()).not.toBeNull();
    expect(w.background).toEqual([]);
    await click(within(ask() as HTMLElement).getByRole("button", { name: "Start anyway" }));
    await settle(() => w.background.length === 1);
    expect(w.background).toEqual([{ cardId: "c1" }]);
  });

  test("by default Start in the background asks nothing", async () => {
    const w = setup();
    form(w);
    await startInBackground();
    expect(ask() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await settle(() => w.background.length === 1);
  });
});

// Issue #78, slice 3b: the spec file on the card page.
describe("card-page-ask-ui: the spec file", () => {
  const fields = (w: ReturnType<typeof setup>, over: object = {}) =>
    render(
      w.wrap(
        <CardFields
          store={w.store}
          hostId="h1"
          card={card({ slug: "cart-screen", ...over })}
          withRoi={false}
          onOpenSettings={() => {}}
        />,
      ),
    );
  const said = () => document.body.textContent ?? "";
  const state = (found: boolean, heading: string | null = null) => ({
    specState: { path: "docs/specs/cart-screen.md", found, heading },
  });

  test("the path field offers the default as its placeholder and saves a path inside the worktree", async () => {
    const w = setup();
    fields(w);
    const field = screen.getByLabelText("Spec file") as HTMLInputElement;
    expect(field.placeholder).toBe("docs/specs/cart-screen.md");
    const save = () => screen.getByRole("button", { name: "Save spec file" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    await act(async () => {
      fireEvent.change(field, { target: { value: "notes/mine.md" } });
    });
    expect(save().disabled).toBe(false);
    await click(save());
    await settle(() => w.commands.length === 1);
    expect(w.commands).toEqual([
      ["h1", "card.update", { cardId: "c1", specPath: "notes/mine.md" }],
    ]);
  });

  test("a path that leaves the worktree cannot be saved, and says why", async () => {
    const w = setup();
    fields(w);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Spec file"), { target: { value: "../out.md" } });
    });
    expect(
      (screen.getByRole("button", { name: "Save spec file" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(said()).toContain("Use a path to a Markdown file inside the worktree");
  });

  test("clearing the field gives the card back its default path", async () => {
    const w = setup();
    fields(w, { specPath: "notes/mine.md" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Spec file"), { target: { value: "" } });
    });
    await click(screen.getByRole("button", { name: "Save spec file" }));
    await settle(() => w.commands.length === 1);
    expect(w.commands).toEqual([["h1", "card.update", { cardId: "c1", specPath: null }]]);
  });

  test("a card with no slug has no default to show", () => {
    const w = setup();
    fields(w, { slug: null });
    expect((screen.getByLabelText("Spec file") as HTMLInputElement).placeholder).toBe(
      "docs/specs/<card>.md",
    );
  });

  test("the page asks the host quietly when it opens, and says what was found", async () => {
    const w = setup();
    fields(w, { worktreePath: "/w", ...state(true, "Cart screen spec") });
    await settle(() => w.requests.length === 1);
    expect(w.requests).toEqual([["h1", "card.spec", { cardId: "c1" }]]);
    expect(w.commands).toEqual([]);
    expect(said()).toContain("Spec found: Cart screen spec");
  });

  test("a spec with no heading is found all the same; a missing one says where it is expected", () => {
    const plain = setup();
    fields(plain, { worktreePath: "/w", ...state(true) });
    expect(said()).toContain("Spec found");
    expect(said()).not.toContain("Spec found:");
    cleanup();
    const missing = setup();
    fields(missing, { worktreePath: "/w", ...state(false) });
    expect(said()).toContain("No spec file at docs/specs/cart-screen.md");
  });

  test("before there is a worktree it says so, and once there is one it says nothing until it looked", () => {
    const w = setup();
    fields(w);
    expect(said()).toContain("which it has not got yet");
    cleanup();
    const there = setup();
    fields(there, { worktreePath: "/w" });
    expect(said()).not.toContain("which it has not got yet");
  });

  test("Check again asks the host, and the answer is a command the person sees fail or not", async () => {
    const w = setup();
    fields(w, { worktreePath: "/w", ...state(false) });
    await click(screen.getByRole("button", { name: "Check again" }));
    await settle(() => w.commands.length === 1);
    expect(w.commands).toEqual([["h1", "card.spec", { cardId: "c1" }]]);
  });
});
