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
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    commands.push([hostId, type, payload]);
    return {};
  }) as never;
  store.startBackground = (async (_hostId: string, payload: unknown) => {
    background.push(payload);
    return true;
  }) as never;
  const t = store.i18n.t;
  const wrap = (child: React.ReactNode) => <TContext.Provider value={t}>{child}</TContext.Provider>;
  return { store, commands, background, wrap };
}

const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });

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
        workflows={[]}
        features={{ personas: false, bg: true, watch: false }}
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
    await click(screen.getByRole("button", { name: "Start in the background" }));
    expect(ask()).not.toBeNull();
    expect(w.background).toEqual([]);
    await click(within(ask() as HTMLElement).getByRole("button", { name: "Start anyway" }));
    await settle(() => w.background.length === 1);
    expect(w.background).toEqual([{ cardId: "c1" }]);
  });

  test("by default Start in the background asks nothing", async () => {
    const w = setup();
    form(w);
    await click(screen.getByRole("button", { name: "Start in the background" }));
    expect(ask() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await settle(() => w.background.length === 1);
  });
});
