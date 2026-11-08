import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { BoardView } = await import("../src/ui/BoardView.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const host = {
  id: "h1",
  name: "alfa",
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: { daemonVersion: "x", features: [] },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
};

const PR = { prUrl: "https://github.com/x/y/pull/1", prState: "open" };

const card = (id: string, column: string, position: number, over: object = {}) => ({
  id,
  projectId: "p1",
  title: id,
  description: `about ${id}`,
  column,
  position,
  createdAt: `2026-11-04T10:0${position}:00Z`,
  waitingOn: [],
  blocking: [],
  branch: null,
  worktreePath: null,
  sessionId: null,
  sessionStatus: null,
  queued: false,
  ...over,
});

const CARDS = [
  card("A", "backlog", 1),
  card("C", "backlog", 2),
  // Ready for Review: a PR and passing checks.
  card("P", "backlog", 3, { ...PR, checksState: "passing" }),
  // In progress with no PR, and with criteria.
  card("D", "in_progress", 1),
  card("G", "in_progress", 2, { description: "Goal\n- [ ] it works" }),
  // Already in Review with a PR whose checks fail, and with none at all.
  card("F", "review", 1, { ...PR, checksState: "failing" }),
  card("N", "review", 2),
  card("E", "done", 1),
];

type Call = [string, string, unknown];

function setup(options: { cards?: object[]; language?: "en" | "pt-BR"; project?: object } = {}) {
  const mem = memoryPlatform(false, options.language ?? "en");
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const internals = store as unknown as { update(p: object): void };
  internals.update({ hosts: [host] });
  internals.update({
    cards: Object.fromEntries(
      (options.cards ?? CARDS).map((c) => [`h1/${(c as { id: string }).id}`, c]),
    ),
  });
  const commands: Call[] = [];
  const requests: Call[] = [];
  /** The cards the board was asked to open: id, and whether with its title ready to edit. */
  const opened: Array<[string, boolean]> = [];
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    commands.push([hostId, type, payload]);
    if (type === "board.get") {
      return { project: { id: "p1", name: "api", ...options.project }, cards: [] };
    }
    return {};
  }) as never;
  store.hostRequest = (async (hostId: string, type: string, payload: unknown) => {
    requests.push([hostId, type, payload]);
    return { ok: true, data: {} };
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <BoardView
        store={store}
        hostId="h1"
        projectId="p1"
        onOpenCard={(id, edit) => {
          opened.push([id, edit === true]);
        }}
        onOpenSettings={() => {}}
      />
    </TContext.Provider>,
  );
  const moves = () => commands.filter(([, type]) => type === "card.move");
  return { store, commands, requests, moves, opened };
}

const li = (title: string) => screen.getByLabelText(`Card ${title}`);
const lane = (name: string) => screen.getByRole("region", { name });
const click = (el: Element, init: object = {}) =>
  act(async () => {
    fireEvent.click(el, init);
  });
const ready = () => settle(() => screen.queryByRole("heading", { name: "Board of api" }) !== null);
const dialog = () => screen.queryByRole("alertdialog");
const dragTo = async (title: string, column: string) => {
  await act(async () => {
    fireEvent.dragStart(li(title));
  });
  await act(async () => {
    fireEvent.drop(lane(column));
  });
};

const pick = async (...titles: string[]) => {
  for (const title of titles) await click(li(title), { ctrlKey: true });
};
const moveSelectedToReview = async () => {
  await act(async () => {
    fireEvent.pointerDown(
      within(screen.getByRole("group", { name: "Selection" })).getByRole("button", {
        name: "Move to…",
      }),
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );
  });
  await click(await screen.findByRole("menuitem", { name: "In review" }));
};

// Issue #78, slice 1: a column asks for what a card already carries; a person can go on anyway.
describe("board-contracts-ui: Review asks for a PR and passing checks", () => {
  test("dropping a card with no PR on Review asks first and names what it lacks", async () => {
    const w = setup();
    await ready();
    await dragTo("A", "In review");
    const ask = dialog();
    expect(ask).not.toBeNull();
    expect(within(ask as HTMLElement).getByText("Move to In review anyway?")).not.toBeNull();
    expect((ask as HTMLElement).textContent).toContain("A lacks: a PR link");
    expect(w.moves()).toEqual([]);
  });

  test("Move anyway moves it, and Cancel leaves it where it was", async () => {
    const w = setup();
    await ready();
    await dragTo("A", "In review");
    await click(within(dialog() as HTMLElement).getByRole("button", { name: "Cancel" }));
    expect(dialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    expect(w.moves()).toEqual([]);
    // The keyboard goes back to the card it asked about.
    await settle(() => li("A").contains(document.activeElement));
    await dragTo("A", "In review");
    await click(within(dialog() as HTMLElement).getByRole("button", { name: "Move anyway" }));
    await settle(() => w.moves().length === 1);
    // The person went on anyway, and the host is told so (issue #78, slice 2).
    expect(w.moves()).toEqual([
      ["h1", "card.move", { cardId: "A", column: "review", force: true }],
    ]);
  });

  test("a card with a PR and passing checks moves with no question", async () => {
    const w = setup();
    await ready();
    await dragTo("P", "In review");
    expect(dialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    expect(w.moves()).toEqual([["h1", "card.move", { cardId: "P", column: "review" }]]);
  });

  test("running checks and failing checks are said as what they are", async () => {
    const w = setup({
      cards: [
        card("R", "backlog", 1, { ...PR, checksState: "pending" }),
        card("X", "backlog", 2, { ...PR, checksState: "failing" }),
      ],
    });
    await ready();
    await dragTo("R", "In review");
    expect((dialog() as HTMLElement).textContent).toContain("R lacks: checks to finish");
    await click(within(dialog() as HTMLElement).getByRole("button", { name: "Cancel" }));
    await dragTo("X", "In review");
    expect((dialog() as HTMLElement).textContent).toContain("X lacks: passing checks");
    expect(w.moves()).toEqual([]);
  });

  test("the card's own Move to Review asks the same, by keyboard too", async () => {
    const w = setup();
    await ready();
    await act(async () => {
      fireEvent.pointerDown(within(li("A")).getByRole("button", { name: "Actions for A" }), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await click(await screen.findByRole("menuitem", { name: "Move to In review" }));
    expect((dialog() as HTMLElement).textContent).toContain("A lacks: a PR link");
    expect(w.moves()).toEqual([]);
  });

  test("moving within the column, or to a column that asks nothing, is never asked", async () => {
    const w = setup();
    await ready();
    await dragTo("N", "In review");
    await dragTo("A", "Done");
    expect(dialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    expect(w.moves()).toHaveLength(2);
  });
});

describe("board-contracts-ui: many cards, one question", () => {
  test("one dialog lists every card that lacks something, and what each lacks", async () => {
    const w = setup();
    await ready();
    await pick("A", "C", "P");
    await moveSelectedToReview();
    const ask = dialog() as HTMLElement;
    expect(ask).not.toBeNull();
    expect(screen.queryAllByRole("alertdialog").length).toBe(1); // NOSONAR: toHaveLength would print the DOM nodes on failure
    expect(ask.textContent).toContain("2 cards lack something In review needs");
    expect(
      within(ask)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["A — a PR link", "C — a PR link"]);
    expect(w.requests).toEqual([]);
  });

  test("Move only the ones that qualify sends the card that has it all", async () => {
    const w = setup();
    await ready();
    await pick("A", "C", "P");
    await moveSelectedToReview();
    await click(
      within(dialog() as HTMLElement).getByRole("button", {
        name: "Move only the ones that qualify",
      }),
    );
    await settle(() => w.requests.length === 1);
    expect(w.requests.map((r) => (r[2] as { cardId: string }).cardId)).toEqual(["P"]);
  });

  test("Move anyway sends them all, in the board's order", async () => {
    const w = setup();
    await ready();
    await pick("A", "C", "P");
    await moveSelectedToReview();
    await click(within(dialog() as HTMLElement).getByRole("button", { name: "Move anyway" }));
    await settle(() => w.requests.length === 3);
    expect(w.requests.map((r) => (r[2] as { cardId: string }).cardId)).toEqual(["A", "C", "P"]);
  });

  test("when every card qualifies there is no question", async () => {
    const w = setup({
      cards: [
        card("P", "backlog", 1, { ...PR, checksState: "passing" }),
        card("Q", "backlog", 2, { ...PR, checksState: "passing" }),
      ],
    });
    await ready();
    await pick("P", "Q");
    await moveSelectedToReview();
    expect(dialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await settle(() => w.requests.length === 2);
  });
});

describe("board-contracts-ui: a card says what it lacks, and a column says what it asks", () => {
  test("In progress never asks, and a card there without criteria wears Needs: acceptance criteria", async () => {
    const w = setup();
    await ready();
    expect(within(li("D")).queryByText("Needs: acceptance criteria")).not.toBeNull();
    expect(within(li("G")).queryByText("Needs: acceptance criteria") === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await dragTo("A", "In progress");
    expect(dialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    expect(w.moves()).toEqual([["h1", "card.move", { cardId: "A", column: "in_progress" }]]);
  });

  test("a card in Review without a PR, or with failing checks, wears what it lacks", async () => {
    setup();
    await ready();
    expect(within(li("N")).queryByText("Needs: a PR link")).not.toBeNull();
    expect(within(li("F")).queryByText("Needs: passing checks")).not.toBeNull();
  });

  // #1197: the chip is a button that goes where the card is fixed: the fields for what the card's
  // text lacks, the card for its PR and checks.
  test("the Needs: chip is a button: criteria open the card on its fields, a PR or checks open the card", async () => {
    const w = setup();
    await ready();
    const chip = (title: string, text: string) =>
      within(li(title)).queryByRole("button", { name: text });
    expect([
      chip("D", "Needs: acceptance criteria") !== null,
      chip("N", "Needs: a PR link") !== null,
      chip("F", "Needs: passing checks") !== null,
    ]).toEqual([true, true, true]);
    for (const [title, text] of [
      ["D", "Needs: acceptance criteria"],
      ["N", "Needs: a PR link"],
      ["F", "Needs: passing checks"],
    ] as const) {
      const button = chip(title, text);
      expect(button).not.toBeNull();
      await act(async () => {
        if (button) fireEvent.click(button);
      });
    }
    expect(w.opened).toEqual([
      ["D", true],
      ["N", false],
      ["F", false],
    ]);
    // The chip is not the card: a click on it neither selects it nor moves it.
    expect(li("D").getAttribute("data-selected")).toBeNull();
    expect(w.moves()).toEqual([]);
  });

  test("a Ctrl-click on the Needs: chip selects the card, as on the rest of the tile, and opens nothing", async () => {
    const w = setup();
    await ready();
    const button = within(li("D")).queryByRole("button", { name: "Needs: acceptance criteria" });
    expect(button).not.toBeNull();
    await act(async () => {
      if (button) fireEvent.click(button, { ctrlKey: true });
    });
    expect(w.opened).toEqual([]);
    expect(li("D").getAttribute("data-selected")).toBe("true");
  });

  test("while a card is dragged, the columns that ask something say what; they stop when it lets go", async () => {
    setup();
    await ready();
    await act(async () => {
      fireEvent.dragStart(li("A"));
    });
    expect(lane("In review").textContent).toContain("Needs: a PR link");
    expect(lane("In review").getAttribute("data-needs")).toBe("true");
    expect(lane("In progress").textContent).toContain("Needs: acceptance criteria");
    expect(lane("Done").getAttribute("data-needs")).toBeNull();
    await act(async () => {
      fireEvent.dragEnd(li("A"));
    });
    expect(lane("In review").getAttribute("data-needs")).toBeNull();
    expect(lane("In review").querySelector(".column-hint") === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
  });

  test("it all reads in Portuguese too", async () => {
    setup({ language: "pt-BR" });
    await settle(() => screen.queryByRole("heading", { name: "Board de api" }) !== null);
    await act(async () => {
      fireEvent.dragStart(screen.getByLabelText("Card A"));
    });
    await act(async () => {
      fireEvent.drop(screen.getByRole("region", { name: "Em revisão" }));
    });
    const ask = dialog() as HTMLElement;
    expect(ask).not.toBeNull();
    expect(ask.textContent).toContain("A ainda precisa de um link de PR.");
    expect(within(ask).getByRole("button", { name: "Mover mesmo assim" })).not.toBeNull();
  });
});

// Issue #78, slice 2: the host keeps each project's contract and the person's override.
describe("board-contracts-ui: the project's contracts, force and the recorded notice", () => {
  test("Move anyway on a group forces every card; the qualifying ones need no force", async () => {
    const w = setup();
    await ready();
    await pick("A", "C", "P");
    await moveSelectedToReview();
    await click(within(dialog() as HTMLElement).getByRole("button", { name: "Move anyway" }));
    await settle(() => w.requests.length === 3);
    expect(w.requests.map((r) => (r[2] as { force?: boolean }).force)).toEqual([true, true, true]);
  });

  test("moving only the ones that qualify sends no force", async () => {
    const w = setup();
    await ready();
    await pick("A", "C", "P");
    await moveSelectedToReview();
    await click(
      within(dialog() as HTMLElement).getByRole("button", {
        name: "Move only the ones that qualify",
      }),
    );
    await settle(() => w.requests.length === 1);
    expect(Object.keys((w.requests[0]?.[2] ?? {}) as object)).not.toContain("force");
  });

  test("a move that asked nothing sends no force", async () => {
    const w = setup();
    await ready();
    await dragTo("P", "In review");
    await settle(() => w.moves().length === 1);
    expect(w.moves()).toEqual([["h1", "card.move", { cardId: "P", column: "review" }]]);
  });

  test("the project's own contract replaces the default: Done can ask for a PR, Review can ask nothing", async () => {
    const w = setup({
      project: {
        contractByColumn: {
          done: { enforce: "confirm", checks: ["pr"] },
          review: { enforce: "confirm", checks: [] },
        },
      },
    });
    await settle(() => screen.queryByRole("heading", { name: "Board of api" }) !== null);
    await dragTo("A", "In review");
    expect(dialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await settle(() => w.moves().length === 1);
    await dragTo("C", "Done");
    expect((dialog() as HTMLElement).textContent).toContain("C lacks: a PR link");
  });

  test("a card in a column wears what the project's contract asks of it, not the default's", async () => {
    setup({ project: { contractByColumn: { review: { enforce: "confirm", checks: [] } } } });
    await ready();
    expect(within(li("N")).queryByText("Needs: a PR link") === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
  });

  test("the notice a forced move left says what the card lacked, in the app's language", async () => {
    setup({
      cards: [
        card("A", "review", 1, {
          notice: "Moved to review anyway: it lacked pr,checksFailing.",
          noticeReason: "card_moved_anyway",
          noticeParams: { column: "review", needs: "pr,checksFailing" },
        }),
      ],
    });
    await ready();
    const absent =
      within(li("A")).queryByText(
        "Moved to In review anyway; it lacked a PR link, passing checks.",
      ) === null;
    expect(absent).toBe(false);
  });

  test("the host's refusal reads as what the card lacks, in Portuguese too", async () => {
    const { translateError } = await import("../src/i18n/errors.ts");
    const { translator } = await import("../src/i18n/index.ts");
    const why = { reason: "card_contract_unmet", params: { column: "review", needs: "pr" } };
    expect(translateError("contract_unmet", "raw", translator("en"), why).title).toBe(
      "This card isn't ready for In review: it lacks a PR link.",
    );
    expect(translateError("contract_unmet", "raw", translator("pt-BR"), why).title).toBe(
      "Este card não está pronto para Em revisão: falta um link de PR.",
    );
  });
});

const openMenu = (title: string, label = `Actions for ${title}`) =>
  act(async () => {
    fireEvent.pointerDown(within(li(title)).getByRole("button", { name: label }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
const startDialog = () => screen.queryByRole("dialog", { name: "Start card" });
const startFromMenu = async (title: string) => {
  await openMenu(title);
  await click(await screen.findByRole("menuitem", { name: "Start card" }));
};

const ASKING = {
  contractByColumn: { in_progress: { enforce: "confirm", checks: ["criteria"] } },
};

// Issue #78, slice 3a: starting asks about criteria only where the project's In progress confirms.
describe("board-contracts-ui: Start asks only when In progress confirms criteria", () => {
  test("by default Start goes straight to the start dialog, with no question", async () => {
    setup();
    await ready();
    await startFromMenu("A");
    expect(dialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await settle(() => startDialog() !== null);
  });

  test("a project that confirms criteria asks first, names what is missing and offers Start anyway", async () => {
    setup({ project: ASKING });
    await ready();
    await startFromMenu("A");
    const ask = dialog() as HTMLElement;
    expect(ask).not.toBeNull();
    expect(ask.textContent).toContain("Start A anyway?");
    expect(ask.textContent).toContain("A lacks: acceptance criteria");
    expect(startDialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await click(within(ask).getByRole("button", { name: "Start anyway" }));
    await settle(() => startDialog() !== null);
    expect(dialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
  });

  test("Cancel starts nothing and gives the card its focus back", async () => {
    setup({ project: ASKING });
    await ready();
    await startFromMenu("A");
    expect(dialog()).not.toBeNull();
    await click(within(dialog() as HTMLElement).getByRole("button", { name: "Cancel" }));
    expect(dialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    expect(startDialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await settle(() => li("A").contains(document.activeElement));
  });

  test("a card with criteria goes straight to the start dialog even where it confirms", async () => {
    setup({ project: ASKING });
    await ready();
    await startFromMenu("G");
    expect(dialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await settle(() => startDialog() !== null);
  });

  test("it reads in Portuguese too", async () => {
    setup({ language: "pt-BR", project: ASKING });
    await settle(() => screen.queryByRole("heading", { name: "Board de api" }) !== null);
    await openMenu("A", "Ações de A");
    await click(await screen.findByRole("menuitem", { name: "Iniciar card" }));
    const ask = dialog() as HTMLElement;
    expect(ask).not.toBeNull();
    expect(ask.textContent).toContain("Iniciar A mesmo assim?");
    expect(ask.textContent).toContain("A ainda precisa de critérios de aceite");
    expect(within(ask).getByRole("button", { name: "Iniciar mesmo assim" })).not.toBeNull();
  });
});

// Issue #78, slice 3b: a column can ask for the spec file the card's worktree has.
describe("board-contracts-ui: a column that asks for a spec", () => {
  const ASKS_SPEC = {
    contractByColumn: { review: { enforce: "confirm", checks: ["spec"] } },
  };
  const found = { path: "docs/specs/s.md", found: true, heading: "S" };
  const cards = [
    card("A", "backlog", 1),
    card("S", "backlog", 2, { specState: found, slug: "s" }),
    card("M", "review", 1),
  ];

  test("dropping a card with no spec on that column asks first and names what it lacks", async () => {
    const w = setup({ cards, project: ASKS_SPEC });
    await ready();
    await dragTo("A", "In review");
    expect((dialog() as HTMLElement | null)?.textContent ?? "").toContain("A lacks: a spec");
    expect(w.moves()).toEqual([]);
  });

  test("a card whose worktree has its spec moves with no question", async () => {
    const w = setup({ cards, project: ASKS_SPEC });
    await ready();
    await dragTo("S", "In review");
    expect(dialog() === null).toBe(true); // NOSONAR: toBeNull/toBeUndefined would print the DOM node on failure
    await settle(() => w.moves().length === 1);
  });

  test("a card in the column without a spec wears what it lacks", async () => {
    setup({ cards, project: ASKS_SPEC });
    await ready();
    expect(within(li("M")).queryByText("Needs: a spec")).not.toBeNull();
  });

  test("it reads in Portuguese too", async () => {
    setup({ cards, project: ASKS_SPEC, language: "pt-BR" });
    await settle(() => screen.queryByRole("heading", { name: "Board de api" }) !== null);
    expect(within(li("M")).queryByText("Precisa de: uma especificação")).not.toBeNull();
  });

  test("the host's refusal names the spec in both languages", async () => {
    const { translateError } = await import("../src/i18n/errors.ts");
    const { translator } = await import("../src/i18n/index.ts");
    const why = { reason: "card_contract_unmet", params: { column: "review", needs: "spec" } };
    expect(translateError("contract_unmet", "raw", translator("en"), why).title).toBe(
      "This card isn't ready for In review: it lacks a spec.",
    );
    expect(translateError("contract_unmet", "raw", translator("pt-BR"), why).title).toBe(
      "Este card não está pronto para Em revisão: falta uma especificação.",
    );
  });
});
