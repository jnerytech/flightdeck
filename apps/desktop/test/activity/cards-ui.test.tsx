import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExternalSession } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { activityState, MIN, NOW } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { ActivityBoard } = await import("../../src/features/activity/board.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #4242: a long title is readable in full, and a Needs you card that cannot be answered
 * here says to open the session. Issue #4243: below 40rem the columns stack.
 */
const css = readFileSync(join(import.meta.dir, "../../src/styles/activity.css"), "utf8");
/** The body of an `@utility <name> { ... }` block, braces matched, or "" when it is not there. */
function utility(name: string): string {
  const at = css.indexOf(`@utility ${name} {`);
  if (at < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  return "";
}

type Spec = Parameters<typeof activityState>[0][number];

const question: ExternalSession = {
  claudeSessionId: "c1",
  cwd: "/w/app",
  transcriptPath: null,
  source: null,
  status: "idle",
  statusReason: null,
  launchId: null,
  controllable: false,
  projectKey: null,
  startedAt: "2026-11-05T11:00:00Z",
  lastEventAt: "2026-11-05T11:57:00Z",
  endedAt: null,
  waiting: "question",
};

function mount(
  language: "en" | "pt-BR",
  specs: Spec[],
  externals: Record<string, ExternalSession>,
) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.now = () => NOW;
  const { hosts, hub, unread } = activityState(specs, store.getState());
  (store as unknown as { update(patch: object): void }).update({
    hosts,
    hostsLoaded: true,
    hub,
    unread,
    externals,
  });
  const opened: Array<[string, boolean]> = [];
  render(
    <TContext.Provider value={store.i18n.t}>
      <ActivityBoard
        store={store}
        go={() => {}}
        onOpen={(row: { title: string }, newTab: boolean) => void opened.push([row.title, newTab])}
        holdMs={30}
        tickMs={20}
      />
    </TContext.Provider>,
  );
  return opened;
}

const needsYou = () =>
  [
    ...document.querySelectorAll("[data-slot='activity-card'][data-column='needs_you']"),
  ] as HTMLElement[];

describe("activity cards: a long title and a request the board cannot answer (#4242)", () => {
  test("the title wraps to two lines instead of being cut to one", () => {
    const rule = utility("activity-card-title");
    expect(rule).not.toBe("");
    expect(rule.includes("nowrap")).toBe(false);
    expect(rule.includes("-webkit-line-clamp: 2")).toBe(true);
  });

  test("a Needs you card with no Approve says to open the session, and the button opens it", async () => {
    const opened = mount("en", [], { "h1/c1": question });
    const card = needsYou()[0];
    expect(card).not.toBeUndefined();
    const open = card ? within(card).queryByRole("button", { name: /^Open to answer/ }) : null;
    expect(open).not.toBeNull();
    await act(async () => {
      if (open) fireEvent.click(open);
    });
    expect(opened).toHaveLength(1);
    expect(opened[0]?.[0]).toBe(card?.getAttribute("aria-label") ?? "");
    expect(opened[0]?.[1]).toBe(false);
  });

  test("it reads in Portuguese", () => {
    mount("pt-BR", [], { "h1/c1": question });
    const card = needsYou()[0];
    expect(card).not.toBeUndefined();
    expect(
      card ? within(card).queryByRole("button", { name: /^Abrir para responder/ }) : null,
    ).not.toBeNull();
  });

  test("a Needs you card with Approve and Deny shows no such button", () => {
    mount(
      "en",
      [{ id: "ask", status: "awaiting_permission", agoMs: 5 * MIN, request: "Fix it" }],
      {},
    );
    const card = needsYou()[0];
    expect(card).not.toBeUndefined();
    expect(
      card ? within(card).queryByRole("button", { name: /^Open to answer/ }) : null,
    ).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^Approve/ }).length).toBe(1); // NOSONAR: a failed length check on DOM elements prints each node
  });
});

describe("activity board: narrow windows (#4243)", () => {
  test("below 40rem the columns stack one under another and the board stops scrolling sideways", () => {
    const rule = utility("activity-board");
    const narrow = rule.slice(rule.indexOf("@media (width < 40rem)"));
    expect(rule.includes("@media (width < 40rem)")).toBe(true);
    expect(narrow.includes("grid-auto-flow: row")).toBe(true);
    expect(narrow.includes("overflow-x: visible")).toBe(true);
  });
});
