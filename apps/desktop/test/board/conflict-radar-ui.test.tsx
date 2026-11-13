import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { cleanup, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { CardConflicts } = await import("../../src/features/board/card-conflicts.tsx");
const { RadarBadge } = await import("../../src/features/board/radar-badge.tsx");
const { CardMergePr } = await import("../../src/features/board/card-merge-pr.tsx");

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
        <CardConflicts card={card({ mayConflict: overlap })} onOpenCard={() => {}} />
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

  test("each title is a button that opens that card, described by the section's heading", () => {
    const opened: string[] = [];
    const one = store();
    render(
      <TContext.Provider value={one.i18n.t}>
        <CardConflicts
          card={card({ mayConflict: overlap })}
          onOpenCard={(cardId) => opened.push(cardId)}
        />
      </TContext.Provider>,
    );
    const open = screen.queryByRole("button", { name: "Fix login" });
    const describedBy = open?.getAttribute("aria-describedby") ?? "";
    expect([
      open !== null,
      screen.queryByRole("button", { name: "Rename user" }) !== null,
      document.getElementById(describedBy)?.textContent,
    ]).toEqual([true, true, "May conflict with other cards"]);
    open?.click();
    screen.queryByRole("button", { name: "Rename user" })?.click();
    expect(opened).toEqual(["c2", "c3"]);
  });

  test("the entries are spaced like the other lists in Details", () => {
    const one = store();
    render(
      <TContext.Provider value={one.i18n.t}>
        <CardConflicts card={card({ mayConflict: overlap })} onOpenCard={() => {}} />
      </TContext.Provider>,
    );
    const section = screen.queryByRole("region", { name: "May conflict with other cards" });
    const lists = [...(section?.querySelectorAll("ul") ?? [])];
    expect(lists[0]?.className.includes("gap-2")).toBe(true);
  });

  test("the badge wraps inside a narrow card and carries an icon, with its full text (#1486)", () => {
    render(<RadarBadge text="May conflict with 2 cards" />);
    const badge = screen.queryByText("May conflict with 2 cards");
    expect([
      badge !== null,
      badge?.classList.contains("max-w-full"),
      badge?.classList.contains("whitespace-normal"),
      badge?.querySelector("svg")?.getAttribute("aria-hidden"),
    ]).toEqual([true, true, true, "true"]);
  });

  test("a card with no overlap has no section", () => {
    const one = store();
    render(
      <TContext.Provider value={one.i18n.t}>
        <CardConflicts card={card()} onOpenCard={() => {}} />
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
