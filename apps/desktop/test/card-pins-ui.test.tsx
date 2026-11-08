import { afterEach, describe, expect, test } from "bun:test";
import type { Card, KnowledgeEntry } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { CardPins } = await import("../src/components/card/card-pins.tsx");

afterEach(cleanup);

/** Issue #76: the documents a card pins, seen and changed from the card. */
const entry = (path: string, over: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
  path,
  title: path,
  type: "adr",
  status: "valid",
  supersedes: null,
  bytes: 1200,
  changedAt: "2026-11-05T10:00:00.000Z",
  problems: [],
  warnings: [],
  hash: `hash-of-${path}`,
  ...over,
});

const OUTBOX = "docs/adr/0003-outbox.md";
const SQLITE = "docs/adr/0001-sqlite.md";
const OLD = "docs/decisions/2026-01-01-old.md";
const LIST = {
  truncated: false,
  entries: [
    entry(SQLITE, { title: "Use SQLite" }),
    entry(OUTBOX, { title: "Use the outbox", status: "transitional" }),
    entry(OLD, { title: "Old decision", status: "obsolete" }),
  ],
};

type Answer = { ok: true; data: unknown } | { ok: false; [key: string]: unknown };

function show(
  options: {
    pins?: string[];
    language?: "en" | "pt-BR";
    library?: boolean;
    path?: string | null;
    answer?: Answer;
  } = {},
) {
  const sent: Array<{ type: string; payload: unknown }> = [];
  const store = {
    hostCommand: async (_host: string, type: string, payload: unknown) => {
      sent.push({ type, payload });
      return type === "knowledge.list" ? LIST : null;
    },
    hostRequest: async (_host: string, type: string, payload: unknown) => {
      sent.push({ type, payload });
      return options.answer ?? { ok: true, data: {} };
    },
  };
  const card = { id: "c1", projectId: "p", pinnedDocs: options.pins ?? [] } as unknown as Card;
  render(
    <TContext.Provider value={translator(options.language ?? "en")}>
      <CardPins
        store={store as never}
        hostId="h"
        card={card}
        path={options.path === undefined ? "/work/api" : options.path}
        library={options.library ?? true}
      />
    </TContext.Provider>,
  );
  return sent;
}

const region = (name = "Pinned documents") => screen.getByRole("region", { name });
const picker = () => within(region()).queryByRole("combobox", { name: "Pin a document" });
const updates = (sent: Array<{ type: string; payload: unknown }>) =>
  sent.filter((s) => s.type === "card.update");

describe("card-pins-ui: the documents pinned to a card (#76)", () => {
  test("each pin shows the library's title, path and status in words; one the library does not list shows its path and says so", async () => {
    show({ pins: [OUTBOX, "docs/adr/9999-gone.md"] });
    await waitFor(() => expect(within(region()).queryByText("Use the outbox")).not.toBeNull());
    const list = within(region()).getAllByRole("listitem");
    expect(list.map((li) => li.textContent)).toEqual([
      `Use the outbox${OUTBOX}TransitionalUnpin`,
      "docs/adr/9999-gone.mdnot in the project's libraryUnpin",
    ]);
  });

  test("with nothing pinned it says so, and the picker offers the library's documents with their status", async () => {
    show();
    expect(within(region()).queryByText("No documents pinned.")).not.toBeNull();
    await waitFor(() => expect(picker()).not.toBeNull());
    await waitFor(() =>
      expect([...(picker() as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
        "Choose a document…",
        "Use SQLite · Valid",
        "Use the outbox · Transitional",
        "Old decision · Obsolete",
      ]),
    );
  });

  test("a document already pinned is not offered again", async () => {
    show({ pins: [SQLITE] });
    await waitFor(() =>
      expect([...(picker() as HTMLSelectElement).options].map((o) => o.value)).toEqual([
        "",
        OUTBOX,
        OLD,
      ]),
    );
  });

  test("choosing a document pins it after the others, and Unpin takes one off; both send the whole list", async () => {
    const sent = show({ pins: [SQLITE] });
    await waitFor(() => expect(picker()).not.toBeNull());
    await waitFor(() => expect((picker() as HTMLSelectElement).options.length).toBeGreaterThan(1));
    await act(async () => {
      fireEvent.change(picker() as HTMLElement, { target: { value: OUTBOX } });
    });
    const pin = within(region()).queryByRole("button", { name: "Pin" });
    expect(pin).not.toBeNull();
    await act(async () => {
      fireEvent.click(pin as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(within(region()).getByRole("button", { name: `Unpin ${SQLITE}` }));
    });
    expect(updates(sent)).toEqual([
      { type: "card.update", payload: { cardId: "c1", pinnedDocs: [SQLITE, OUTBOX] } },
      { type: "card.update", payload: { cardId: "c1", pinnedDocs: [] } },
    ]);
  });

  test("a refused save says why in an alert", async () => {
    show({
      pins: [SQLITE],
      answer: { ok: false, code: "bad_request", message: "no", reason: "pinned_doc_invalid" },
    });
    await act(async () => {
      fireEvent.click(within(region()).getByRole("button", { name: `Unpin ${SQLITE}` }));
    });
    await waitFor(() => expect(within(region()).queryByRole("alert")).not.toBeNull());
    const text = within(region()).getByRole("alert").textContent ?? "";
    expect([
      text.includes("Could not save the pinned documents:"),
      text.includes("Markdown file in the project's docs"),
    ]).toEqual([true, true]);
  });

  test("at ten pins the picker is off and says why", async () => {
    const many = Array.from({ length: 10 }, (_, i) => `docs/adr/${i}.md`);
    show({ pins: many });
    await waitFor(() => expect(picker()).not.toBeNull());
    expect([
      (picker() as HTMLSelectElement).disabled,
      within(region()).queryByText("A card pins at most 10 documents.") !== null,
    ]).toEqual([true, true]);
  });

  test("a host without the library, or a card with no project folder, still shows the pins to take off, with no picker", async () => {
    show({ pins: [SQLITE], library: false });
    expect([picker() === null, within(region()).queryByText(SQLITE) !== null]).toEqual([
      true,
      true,
    ]);
    cleanup();
    show({ pins: [SQLITE], path: null });
    expect(picker()).toBeNull();
  });

  test("in Portuguese the panel and its picker are in Portuguese", async () => {
    show({ pins: [SQLITE], language: "pt-BR" });
    const pt = screen.getByRole("region", { name: "Documentos fixados" });
    await waitFor(() =>
      expect(within(pt).queryByRole("combobox", { name: "Fixar um documento" })).not.toBeNull(),
    );
    expect(within(pt).queryByRole("button", { name: `Desafixar ${SQLITE}` })).not.toBeNull();
  });
});

// #1088: in Chromium on Windows, an arrow key on a closed select changes its value and fires
// change. Pinning on change pinned every document a keyboard-only person arrowed past. The select
// now only chooses; Pin pins. Focus stays on the picker after Pin and Unpin, and the panel says
// what changed.
describe("card-pins-ui: choosing is not pinning, and the keyboard keeps its place (#1088)", () => {
  for (const [language, names] of [
    [
      "en",
      {
        region: "Pinned documents",
        picker: "Pin a document",
        pin: "Pin",
        reason: "Choose a document to pin.",
        pinned: "Pinned: Use the outbox.",
        unpin: `Unpin ${SQLITE}`,
        unpinned: "Unpinned: Use SQLite.",
      },
    ],
    [
      "pt-BR",
      {
        region: "Documentos fixados",
        picker: "Fixar um documento",
        pin: "Fixar",
        reason: "Escolha um documento para fixar.",
        pinned: "Fixado: Use the outbox.",
        unpin: `Desafixar ${SQLITE}`,
        unpinned: "Desafixado: Use SQLite.",
      },
    ],
  ] as const) {
    const panel = () => screen.getByRole("region", { name: names.region });
    const pick = () =>
      within(panel()).queryByRole("combobox", { name: names.picker }) as HTMLSelectElement | null;
    const pinButton = () => within(panel()).queryByRole("button", { name: names.pin });

    test(`${language}: arrowing through the picker pins nothing; Pin is off with its reason until a document is chosen`, async () => {
      const sent = show({ pins: [SQLITE], language });
      await waitFor(() => expect((pick()?.options.length ?? 0) > 1).toBe(true));
      const reason = within(panel()).queryByText(names.reason);
      expect([
        pinButton()?.hasAttribute("disabled") ?? null,
        reason !== null && pinButton()?.getAttribute("aria-describedby") === reason.id,
      ]).toEqual([true, true]);
      await act(async () => {
        fireEvent.change(pick() as HTMLElement, { target: { value: OUTBOX } });
      });
      await act(async () => {
        fireEvent.change(pick() as HTMLElement, { target: { value: OLD } });
      });
      expect([updates(sent).length, pinButton()?.hasAttribute("disabled") ?? null]).toEqual([
        0,
        false,
      ]);
    });

    test(`${language}: Pin pins the chosen one, says so, and leaves the focus on the picker; so does Unpin`, async () => {
      show({ pins: [SQLITE], language });
      await waitFor(() => expect((pick()?.options.length ?? 0) > 1).toBe(true));
      await act(async () => {
        fireEvent.change(pick() as HTMLElement, { target: { value: OUTBOX } });
      });
      expect(pinButton()).not.toBeNull();
      await act(async () => {
        fireEvent.click(pinButton() as HTMLElement);
      });
      const status = () => within(panel()).queryByRole("status")?.textContent ?? "";
      await waitFor(() => expect(status()).toBe(names.pinned));
      expect([document.activeElement === pick(), pick()?.value]).toEqual([true, ""]);
      await act(async () => {
        fireEvent.click(within(panel()).getByRole("button", { name: names.unpin }));
      });
      await waitFor(() => expect(status()).toBe(names.unpinned));
      expect(document.activeElement === pick()).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    });
  }
});

// #1088, ux-review: focus never falls to the page's body. When the picker cannot take it (the pin
// filled the card, or there is no picker), the status line takes it; a failed save moves nothing and
// keeps the choice; the reason under Pin is a line of its own, not hung over the status line.
describe("card-pins-ui: where the focus goes when the picker cannot take it (#1088)", () => {
  const panel = () => screen.getByRole("region", { name: "Pinned documents" });
  const pick = () =>
    within(panel()).queryByRole("combobox", { name: "Pin a document" }) as HTMLSelectElement | null;
  const status = () => within(panel()).queryByRole("status");
  const choose = async (value: string) => {
    await waitFor(() => expect((pick()?.options.length ?? 0) > 1).toBe(true));
    await act(async () => {
      fireEvent.change(pick() as HTMLElement, { target: { value } });
    });
  };
  const press = async (name: string) => {
    const button = within(panel()).queryByRole("button", { name });
    expect(button).not.toBeNull();
    await act(async () => {
      (button as HTMLElement).focus();
      fireEvent.click(button as HTMLElement);
    });
  };

  test("a pin that fills the card leaves the focus on the status line", async () => {
    show({ pins: Array.from({ length: 9 }, (_, i) => `docs/adr/9${i}.md`) });
    await choose(OUTBOX);
    await press("Pin");
    await waitFor(() => expect(status()?.textContent).toBe("Pinned: Use the outbox."));
    expect(document.activeElement === status()).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("with no picker, Unpin leaves the focus on the status line", async () => {
    show({ pins: [SQLITE], library: false });
    await press(`Unpin ${SQLITE}`);
    await waitFor(() => expect(status()?.textContent).toBe(`Unpinned: ${SQLITE}.`));
    expect(document.activeElement === status()).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a refused pin keeps the choice and the focus, and says why", async () => {
    show({
      pins: [SQLITE],
      answer: { ok: false, code: "bad_request", message: "no", reason: "pinned_doc_invalid" },
    });
    await choose(OUTBOX);
    await press("Pin");
    await waitFor(() => expect(within(panel()).queryByRole("alert")).not.toBeNull());
    expect([pick()?.value, document.activeElement?.textContent, status()?.textContent]).toEqual([
      OUTBOX,
      "Pin",
      "",
    ]);
  });

  test("the reason under Pin is a line of its own, not hung from the button", async () => {
    show({ pins: [SQLITE] });
    await waitFor(() => expect(pick()).not.toBeNull());
    const reason = within(panel()).queryByText("Choose a document to pin.");
    expect([reason !== null, reason?.closest(".action-button-box") == null]).toEqual([true, true]);
  });
});
