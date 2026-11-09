import { afterEach, describe, expect, test } from "bun:test";
import type { ChangesResult, ReviewComment } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { TContext } = await import("../src/i18n/context.tsx");
const { ChangesPanel } = await import("../src/ui/ChangesPanel.tsx");
const { CardSecondOpinion } = await import("../src/components/card/card-second-opinion.tsx");

afterEach(() => cleanup());

/**
 * #1496: after a second opinion, the result said its findings were "drafts below", but they sit
 * after the whole diff and nothing led there. A button next to that line now puts the focus on the
 * first reviewer draft, which brings it into view.
 */
const CHANGES = {
  target: "card:c1",
  root: "/w",
  base: "main",
  position: null,
  files: [
    {
      path: "src/cart.ts",
      oldPath: null,
      status: "modified",
      additions: 1,
      deletions: 0,
      uncommitted: false,
      binary: false,
      hunks: [
        {
          header: "@@ -1,0 +1,1 @@",
          oldStart: 1,
          newStart: 1,
          lines: [{ op: "+", text: "total += price" }],
        },
      ],
    },
  ],
} as unknown as ChangesResult;

const comment = (over: Partial<ReviewComment> & object): ReviewComment =>
  ({
    id: "p1",
    target: "card:c1",
    path: "src/cart.ts",
    side: "new",
    lineStart: 1,
    lineEnd: 1,
    quote: "total += price",
    body: "My own note.",
    state: "draft",
    createdAt: "2026-11-09T10:00:00Z",
    sentAt: null,
    outdated: false,
    ...over,
  }) as ReviewComment;

const COMMENTS = [
  comment({}),
  comment({ id: "r1", body: "Floats lose cents.", author: "reviewer", severity: "high" }),
];

const card = {
  id: "c1",
  projectId: "p1",
  title: "Cart screen",
  description: "",
  column: "in_progress",
  prUrl: null,
  prState: null,
  sessionId: "s1",
  sessionStatus: "ended",
  queued: false,
  worktreePath: "/w",
} as never;

async function show(language: "en" | "pt-BR", anchored = 1) {
  const store = {
    hostRequest: async (_host: string, type: string) =>
      type === "card.review"
        ? {
            ok: true,
            data: {
              state: "done",
              summary: "One risk.",
              anchored,
              loose: [],
              cached: false,
              moved: false,
            },
          }
        : { ok: true, data: CHANGES },
    hostCommand: async (_host: string, type: string) =>
      type === "review.list" ? { comments: COMMENTS } : null,
    watchChanges: () => () => {},
    canOpenPaths: () => false,
    later: () => () => {},
    now: () => Date.now(),
    success: () => {},
    copyText: async () => {},
  } as never;
  render(
    <TContext.Provider value={translator(language)}>
      <ChangesPanel
        store={store}
        hostId="h1"
        target="card:c1"
        extra={(changes, refresh, goToDrafts) => (
          <CardSecondOpinion
            store={store}
            hostId="h1"
            card={card}
            changes={changes}
            onReviewed={refresh}
            onGoToDrafts={goToDrafts}
          />
        )}
      />
    </TContext.Provider>,
  );
  await act(async () => {});
  const ask = screen.queryByRole("button", {
    name: translator(language)("secondOpinion.ask"),
  });
  await act(async () => {
    if (ask) fireEvent.click(ask);
  });
  // The review came back and the drafts are in the list: what the button needs is on the page.
  expect([
    (document.body.textContent ?? "").includes("One risk."),
    (document.body.textContent ?? "").includes("Floats lose cents."),
  ]).toEqual([true, true]);
}

const press = async (name: string) => {
  const found = screen.queryByRole("button", { name });
  expect(found).not.toBeNull();
  await act(async () => {
    if (found) fireEvent.click(found);
  });
};

describe("second-opinion-drafts-ui: going to the reviewer drafts (#1496)", () => {
  test("Go to the drafts puts the focus on the first reviewer draft, not on a person's", async () => {
    await show("en");
    await press("Go to the drafts");
    const focused = document.activeElement?.textContent ?? "";
    expect([focused.includes("Floats lose cents."), focused.includes("My own note.")]).toEqual([
      true,
      false,
    ]);
  });

  test("in pt-BR the button is Ir para os rascunhos", async () => {
    await show("pt-BR");
    await press("Ir para os rascunhos");
    expect((document.activeElement?.textContent ?? "").includes("Floats lose cents.")).toBe(true);
  });

  test("a review that placed no draft offers no button", async () => {
    await show("en", 0);
    expect(screen.queryByRole("button", { name: "Go to the drafts" }) === null).toBe(true);
  });
});
