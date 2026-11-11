import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, stays } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { CardSecondOpinion } = await import("../src/features/board/card-second-opinion.tsx");
const { ReviewList } = await import("../src/ui/ReviewList.tsx");
const { CardRunForm } = await import("../src/features/board/card-run-form.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #1446 (docs/decisions/2026-11-09-second-opinion-review.md): a button in a card's Changes asks for
 * a second-opinion review; its findings come back as reviewer drafts with a severity, and those that
 * fell on no changed line are listed as text. The Open PR confirm says how many are still open.
 */
const card = (over: object = {}) =>
  ({
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
    ...over,
  }) as never;
const changes = (files = 2) =>
  ({
    root: "/w",
    base: "main",
    files: Array.from({ length: files }, (_, i) => ({ path: `src/f${i}.ts` })),
  }) as never;
const result = (over: object = {}) => ({
  state: "done",
  summary: "Two risks in the cart total.",
  anchored: 2,
  loose: [],
  cached: false,
  moved: false,
  ...over,
});

type Answer = { ok: true; data: unknown } | { ok: false; code: string; message: string } | object;

function setup(
  options: {
    language?: "en" | "pt-BR";
    answer?: Answer;
    hold?: Promise<void>;
    reviewed?: () => void | Promise<void>;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const asked: Array<[string, unknown]> = [];
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    asked.push([type, payload]);
    await options.hold;
    return options.answer ?? { ok: true, data: result() };
  }) as never;
  const seen = { reviewed: 0 };
  const view = (over: object = {}, files = 2) => (
    <TContext.Provider value={store.i18n.t}>
      <CardSecondOpinion
        store={store}
        hostId="h1"
        card={card(over)}
        changes={changes(files)}
        onReviewed={() => {
          seen.reviewed++;
          return options.reviewed?.();
        }}
      />
    </TContext.Provider>
  );
  return { store, asked, seen, view };
}

const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const ask = async (name: string | RegExp = "Get a second opinion") => {
  const found = button(name);
  expect(found).not.toBeNull();
  await act(async () => {
    if (found) fireEvent.click(found);
  });
};
const text = (name = "Second opinion") =>
  (screen.queryByRole("region", { name })?.textContent ?? "").replace(/\s+/g, " ");

describe("second-opinion-ui: asking for the review (#1446)", () => {
  test("the button asks the host once, says how many findings are drafts, and the panel reads them", async () => {
    const { asked, seen, view } = setup();
    render(view());
    await ask();
    await settle(() => text().includes("Two risks"));
    expect([
      asked,
      text().includes("Two risks in the cart total."),
      text().includes("2 findings are drafts"),
      seen.reviewed,
    ]).toEqual([[["card.review", { cardId: "c1", language: "en" }]], true, true, 1]);
  });

  test("a finding that fell on no changed line is listed as plain text with its place and severity", async () => {
    const body = "Use <b>cents</b> not floats [x](javascript:alert(1))";
    const { view } = setup({
      answer: {
        ok: true,
        data: result({
          anchored: 0,
          loose: [{ path: "src/cart.ts", line: 40, severity: "high", body }],
        }),
      },
    });
    render(view());
    await ask();
    await settle(() => text().includes("src/cart.ts"));
    const region = screen.queryByRole("region", { name: "Second opinion" });
    expect([
      text().includes("src/cart.ts:40"),
      text().includes("High"),
      text().includes(body),
      region?.querySelector("b, a") === null,
    ]).toEqual([true, true, true, true]);
  });

  test("a review of the same diff, one the diff outran and one that did not answer each say so", async () => {
    const said = async (data: object) => {
      const { view } = setup({
        answer: { ok: true, data: result({ summary: "Opened the review.", ...data }) },
      });
      const one = render(view());
      await ask();
      await settle(() => text().includes("Opened the review."));
      const out = text();
      one.unmount();
      return out;
    };
    const cached = await said({ cached: true });
    const moved = await said({ moved: true, anchored: 0 });
    const failed = await said({ state: "failed", anchored: 0 });
    expect([
      cached.includes("This diff was reviewed already"),
      moved.includes("The diff changed during the review"),
      failed.includes("did not answer in the expected form"),
    ]).toEqual([true, true, true]);
  });

  test("a refusal says why, and nothing else appears", async () => {
    const { view } = setup({
      answer: {
        ok: false,
        code: "invalid_state",
        message: "no review now",
        reason: "card_review_held",
        params: { hold: "quota" },
      },
    });
    render(view());
    await ask();
    await settle(() => screen.queryByRole("alert") !== null);
    expect([
      screen.queryByRole("alert")?.textContent?.includes("No review now") ?? false,
      text().includes("Two risks"),
    ]).toEqual([true, false]);
  });

  test("the limit and a review already running are said in their own words", async () => {
    const refuse = async (reason: string, params?: object) => {
      const { view } = setup({
        answer: { ok: false, code: "invalid_state", message: "m", reason, params },
      });
      const one = render(view());
      await ask();
      await settle(() => screen.queryByRole("alert") !== null);
      const out = screen.queryByRole("alert")?.textContent ?? "";
      one.unmount();
      return out;
    };
    const limit = await refuse("card_review_limit", { max: "3" });
    const running = await refuse("card_review_running");
    expect([limit.includes("3 reviews"), running.includes("already running")]).toEqual([
      true,
      true,
    ]);
  });

  test("with a run going or no changes the button is off, says why, and asks nothing", async () => {
    const running = setup();
    render(running.view({ sessionStatus: "running" }));
    const off = button("Get a second opinion");
    const why = off?.getAttribute("aria-describedby");
    expect([
      off?.hasAttribute("disabled"),
      why ? (document.getElementById(why)?.textContent ?? "") : "",
      running.asked.length,
    ]).toEqual([true, "A run is going: wait for it to end.", 0]);
    cleanup();
    const empty = setup();
    render(empty.view({}, 0));
    expect([
      button("Get a second opinion")?.hasAttribute("disabled"),
      text().includes("no changes to review"),
    ]).toEqual([true, true]);
  });

  test("while the host reads the diff the button is off, so a second click asks nothing", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { asked, view } = setup({ hold });
    render(view());
    await ask();
    const during = button("Get a second opinion");
    await act(async () => {
      if (during) fireEvent.click(during);
    });
    const waiting = [
      during?.hasAttribute("disabled"),
      text().includes("Reading the diff"),
      asked.length,
    ];
    release();
    await settle(() => text().includes("Two risks"));
    expect(waiting).toEqual([true, true, 1]);
  });

  test("when the answer arrives, focus is back on the button, whether it brought a result or a refusal (#1495)", async () => {
    const focused = () => document.activeElement === button("Get a second opinion");
    const { store, view } = setup();
    render(view());
    // The button is off while the host reads, so the browser drops its focus: only the return after the
    // answer can put it back.
    (document.activeElement as HTMLElement | null)?.blur();
    await ask();
    await settle(() => text().includes("Two risks"));
    await settle(focused, 5000, "focus back on the button after a result");
    store.hostRequest = (async () => {
      throw new Error("the connection dropped");
    }) as never;
    (document.activeElement as HTMLElement | null)?.blur();
    await ask();
    await settle(() => screen.queryByRole("alert") !== null);
    await settle(focused, 5000, "focus back on the button after a refusal");
  });

  test("focus the person moved elsewhere while the host read is not taken back (#1495)", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { view } = setup({ hold });
    render(
      <>
        {view()}
        <textarea aria-label="Comment" />
      </>,
    );
    await ask();
    const comment = screen.queryByRole("textbox", { name: "Comment" });
    expect(comment).not.toBeNull();
    comment?.focus();
    release();
    await settle(() => text().includes("Two risks"));
    await stays(() => document.activeElement === comment, 300, "focus stays on the comment");
  });

  test("two clicks in the same tick ask the host once, and the button says it is busy while it reads (#1495)", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { asked, view } = setup({ hold });
    render(view());
    const found = button("Get a second opinion");
    expect(found).not.toBeNull();
    // One act, so React renders nothing between the clicks: only the ref guard stops the second.
    await act(async () => {
      found?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      found?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const waiting = [asked.length, button("Get a second opinion")?.getAttribute("aria-busy")];
    release();
    await settle(() => text().includes("Two risks"));
    expect(waiting).toEqual([1, "true"]);
  });

  test("a failed read of the panel's comments after the review leaves the result shown and the button back (#1495)", async () => {
    const { view } = setup({
      reviewed: () => Promise.reject(new Error("the connection dropped")),
    });
    render(view());
    await ask();
    await settle(() => text().includes("Two risks"));
    expect([
      text().includes("2 findings are drafts"),
      button("Get a second opinion")?.hasAttribute("disabled"),
    ]).toEqual([true, false]);
  });

  test("in pt-BR the button and the result are translated", async () => {
    const { view } = setup({ language: "pt-BR" });
    render(view());
    await ask("Pedir uma segunda opinião");
    await settle(() => text("Segunda opinião").includes("Two risks"));
    expect(text("Segunda opinião").includes("2 achados viraram rascunhos")).toBe(true);
  });
});

describe("second-opinion-ui: what the review's own review asked for (#1446)", () => {
  test("a request that never reaches the host says so, and the button is back", async () => {
    const { store, view } = setup();
    store.hostRequest = (async () => {
      throw new Error("the connection dropped");
    }) as never;
    render(view());
    await ask();
    await settle(() => screen.queryByRole("alert") !== null);
    expect([
      screen.queryByRole("alert")?.textContent?.includes("did not answer") ?? false,
      button("Get a second opinion")?.hasAttribute("disabled"),
    ]).toEqual([true, false]);
  });

  test("a card waiting for a free slot says that, not that a run is going", () => {
    const { view } = setup();
    render(view({ queued: true, sessionStatus: null }));
    const off = button("Get a second opinion");
    const why = off?.getAttribute("aria-describedby");
    expect([
      off?.hasAttribute("disabled"),
      why ? (document.getElementById(why)?.textContent ?? "") : "",
    ]).toEqual([true, "The card waits for a free slot: wait for it to start and end."]);
  });

  test("the result's live region is on the page before the answer, so it is announced", () => {
    const { view } = setup();
    render(view());
    const region = screen.queryByRole("region", { name: "Second opinion" });
    expect(region !== null && within(region).queryByRole("status") !== null).toBe(true);
  });
});

const reviewer = (over: object = {}) => ({
  id: "r1",
  path: "src/cart.ts",
  side: "new",
  lineStart: 40,
  lineEnd: 40,
  quote: "total += price",
  body: "Floats lose cents.",
  state: "draft",
  outdated: false,
  author: "reviewer",
  severity: "high",
  ...over,
});

function list(comments: object[]) {
  const removed: string[] = [];
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  render(
    <TContext.Provider value={store.i18n.t}>
      <ReviewList
        comments={comments as never}
        onUpdate={() => {}}
        onRemove={(id) => {
          removed.push(id);
        }}
        onSend={() => {}}
      />
    </TContext.Provider>,
  );
  return { removed };
}

describe("second-opinion-ui: reviewer drafts in the review list (#1446)", () => {
  test("a reviewer draft says it is the reviewer's and how severe, in words; a person's does not", () => {
    list([reviewer(), reviewer({ id: "p1", author: undefined, severity: undefined })]);
    const items = screen.queryAllByRole("listitem");
    expect([
      items[0]?.textContent?.includes("Reviewer"),
      items[0]?.textContent?.includes("High"),
      items[1]?.textContent?.includes("Reviewer"),
    ]).toEqual([true, true, false]);
  });

  test("Dismiss removes a reviewer draft by name, and a person's draft keeps its own remove", async () => {
    const { removed } = list([
      reviewer(),
      reviewer({ id: "p1", author: undefined, severity: undefined }),
    ]);
    const dismiss = screen.queryByRole("button", { name: /^Dismiss/ });
    const own = screen.queryAllByRole("button", { name: /^Remove/ });
    await act(async () => {
      if (dismiss) fireEvent.click(dismiss);
    });
    expect([dismiss !== null, own.length, removed]).toEqual([true, 1, ["r1"]]);
  });
});

describe("second-opinion-ui: the Open PR confirm (#1446)", () => {
  async function openPr(comments: object[]) {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    store.hostCommand = (async (_h: string, type: string) =>
      type === "review.list" ? { comments } : {}) as never;
    store.hostRequest = (async () => ({ ok: true, data: {} })) as never;
    store.prWatch.describe = (async () => ({ text: "Adds the cart", redacted: 0 })) as never;
    render(
      <TContext.Provider value={store.i18n.t}>
        <CardRunForm
          store={store}
          hostId="h1"
          card={card()}
          features={{ bg: true, watch: true, secondOpinion: true }}
          tab="diff"
          canMerge={false}
          gateWaiting={false}
          onMerge={() => {}}
          arenaStart={null}
          onDiscarded={() => {}}
          onShowDiff={() => {}}
        />
      </TContext.Provider>,
    );
    const lead = screen.queryByRole("button", { name: "Open PR" });
    expect(lead).not.toBeNull();
    await act(async () => {
      if (lead) fireEvent.click(lead);
    });
    await settle(() => screen.queryByRole("dialog") !== null);
    return (screen.queryByRole("dialog")?.textContent ?? "").replace(/\s+/g, " ");
  }

  test("it says how many reviewer findings are still open when a high one is", async () => {
    const out = await openPr([reviewer(), reviewer({ id: "r2", severity: "low" })]);
    expect(out.includes("2 reviewer findings not addressed (1 high)")).toBe(true);
  });

  test("a second click while the description is being made does not ask for it again", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    store.hostCommand = (async () => ({ comments: [] })) as never;
    store.hostRequest = (async () => ({ ok: true, data: {} })) as never;
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let described = 0;
    store.prWatch.describe = (async () => {
      described++;
      await hold;
      return { text: "Adds the cart", redacted: 0 };
    }) as never;
    render(
      <TContext.Provider value={store.i18n.t}>
        <CardRunForm
          store={store}
          hostId="h1"
          card={card()}
          features={{ bg: true, watch: true, secondOpinion: true }}
          tab="diff"
          canMerge={false}
          gateWaiting={false}
          onMerge={() => {}}
          arenaStart={null}
          onDiscarded={() => {}}
          onShowDiff={() => {}}
        />
      </TContext.Provider>,
    );
    const lead = screen.queryByRole("button", { name: "Open PR" });
    expect(lead).not.toBeNull();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        if (lead) fireEvent.click(lead);
      });
    }
    release();
    await settle(() => screen.queryByRole("dialog") !== null);
    expect(described).toBe(1);
  });

  test("with only low findings, or none, it says nothing", async () => {
    const low = await openPr([reviewer({ severity: "low" })]);
    cleanup();
    const none = await openPr([]);
    // The dialog is there in both (its title is the control): only the line is missing.
    expect([
      low.includes("PR description"),
      none.includes("PR description"),
      low.includes("reviewer finding"),
      none.includes("reviewer finding"),
    ]).toEqual([true, true, false, false]);
  });
});
