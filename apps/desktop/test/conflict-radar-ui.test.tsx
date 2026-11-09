import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, render, screen, within } = await import("@testing-library/react");
const { AppStore, sessionKey } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { CardDetail } = await import("../src/ui/CardDetail.tsx");
const { CardConflicts } = await import("../src/components/card/card-conflicts.tsx");
const { CardMergePr } = await import("../src/components/card/card-merge-pr.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #1405: Details lists each card that changes the same files and the files they share; the Merge PR
 * confirm says merging may leave those cards with conflicts. A card with no overlap shows neither.
 */
const overlap = [
  { cardId: "c2", title: "Fix login", files: ["src/login.ts", "src/session.ts"] },
  { cardId: "c3", title: "Rename user", files: ["src/session.ts"] },
];
const card = (over: Partial<Card> = {}) =>
  ({
    id: "c1",
    prUrl: "https://github.com/acme/repo/pull/9",
    prState: "open",
    checksState: "passing",
    ...over,
  }) as Card;

function store() {
  const one = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  one.i18n.start();
  return one;
}

describe("conflict-radar-ui: Details and the Merge PR confirm (#1405)", () => {
  test("Details lists each card and the files they share, under a heading", () => {
    const one = store();
    render(
      <TContext.Provider value={one.i18n.t}>
        <CardConflicts card={card({ mayConflict: overlap })} />
      </TContext.Provider>,
    );
    const section = screen.queryByRole("region", { name: "May conflict with other cards" });
    const text = (section?.textContent ?? "").replace(/\s+/g, " ");
    expect([
      section !== null,
      text.includes("Fix login"),
      text.includes("src/login.ts"),
      text.includes("src/session.ts"),
      text.includes("Rename user"),
      // Two cards and the three files they list: src/session.ts is named under both.
      within(section ?? document.body).queryAllByRole("listitem").length,
    ]).toEqual([true, true, true, true, true, 5]);
  });

  test("the card's page carries the section: it is part of Details, not only a component of its own", async () => {
    const one = store();
    one.hostCommand = (async () => null) as never;
    one.hostRequest = (async () => ({ ok: false, error: { code: "x", message: "x" } })) as never;
    const full = {
      ...card({ mayConflict: overlap }),
      projectId: "p1",
      title: "Cart screen",
      description: "",
      column: "in_progress",
      columnLocked: false,
      position: 1,
      slug: "cart",
      branch: "fd/cart",
      worktreePath: null,
      queued: false,
      sessionId: null,
      sessionStatus: null,
      notice: null,
      discarded: false,
      runs: [],
      workflowRunId: null,
      arenaOf: null,
      variant: null,
      arenaVariants: 0,
      issueRef: null,
      issueExternal: false,
      queueReason: null,
      quotaUntil: null,
      createdAt: "2026-11-08T12:00:00.000Z",
      updatedAt: "2026-11-08T12:00:00.000Z",
    };
    render(
      <TContext.Provider value={one.i18n.t}>
        <CardDetail
          store={one}
          hostId="h1"
          cardId="c1"
          onOpenSettings={() => {}}
          onOpenWorkflows={() => {}}
          onBack={() => {}}
          onOpenCard={() => {}}
        />
      </TContext.Provider>,
    );
    await act(async () => {
      (one as unknown as { update(patch: object): void }).update({
        cards: { [sessionKey("h1", "c1")]: full },
      });
    });
    await settleMaybe(
      () => screen.queryByRole("region", { name: "May conflict with other cards" }) !== null,
      5000,
    );
    const section = screen.queryByRole("region", { name: "May conflict with other cards" });
    expect((section?.textContent ?? "").includes("Fix login")).toBe(true);
  });

  test("a card with no overlap has no section", () => {
    const one = store();
    render(
      <TContext.Provider value={one.i18n.t}>
        <CardConflicts card={card()} />
      </TContext.Provider>,
    );
    expect(screen.queryByRole("region", { name: "May conflict with other cards" })).toBeNull();
  });

  test("the Merge PR confirm says merging may leave the other cards with conflicts", async () => {
    const one = store();
    render(
      <TContext.Provider value={one.i18n.t}>
        <CardMergePr
          store={one}
          hostId="h1"
          card={card({ mayConflict: overlap })}
          open
          onOpenChange={() => {}}
        />
      </TContext.Provider>,
    );
    await settleMaybe(() => screen.queryByRole("alertdialog") !== null, 5000);
    const text = (screen.queryByRole("alertdialog")?.textContent ?? "").replace(/\s+/g, " ");
    expect([
      text.includes("Merge PR"),
      text.includes("Other cards change the same files: Fix login, Rename user."),
    ]).toEqual([true, true]);
  });
});
