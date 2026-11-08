import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { useState } = await import("react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { CardMergePr } = await import("../src/components/card/card-merge-pr.tsx");
const { canMergeCardPr } = await import("../src/lib/card-merge-pr.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1196: a card merges its open PR from the card. Nothing merges before the confirm; the
 * confirm sends `card.pr.merge` with the way chosen; a refusal says why, in place, with a link to
 * the PR.
 */
const PR_URL = "https://github.com/acme/repo/pull/9";
const card = (over: Partial<Card> = {}) =>
  ({ id: "c1", prUrl: PR_URL, prState: "open", checksState: "passing", ...over }) as Card;

type Answer =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      reason?: string;
      params?: Record<string, string>;
    };

/** The card's own state: open at first, closed by the dialog as the card does. */
function Harness(
  props: Readonly<{
    store: InstanceType<typeof AppStore>;
    card: Card;
    onOpenChange(open: boolean): void;
  }>,
) {
  const [open, setOpen] = useState(true);
  return (
    <TContext.Provider value={props.store.i18n.t}>
      <CardMergePr
        store={props.store}
        hostId="h1"
        card={props.card}
        open={open}
        onOpenChange={(next) => {
          props.onOpenChange(next);
          setOpen(next);
        }}
      />
    </TContext.Provider>
  );
}

function setup(options: { language?: "en" | "pt-BR"; answer?: Answer; card?: Card } = {}) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const sent: Array<[string, unknown]> = [];
  const opened: string[] = [];
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    return options.answer ?? { ok: true, data: card({ prState: "merged" }) };
  }) as never;
  store.openLink = (url: string) => {
    opened.push(url);
  };
  const closed: boolean[] = [];
  const view = (
    <Harness
      store={store}
      card={options.card ?? card()}
      onOpenChange={(next) => closed.push(next)}
    />
  );
  return { store, sent, opened, closed, view };
}

const dialog = () => screen.queryByRole("alertdialog") as HTMLElement | null;
const inDialog = (name: string | RegExp) =>
  dialog() ? within(dialog() as HTMLElement).queryByRole("button", { name }) : null;
async function click(target: HTMLElement | null) {
  if (target) await act(async () => fireEvent.click(target));
  return target !== null;
}
async function opened(name: string) {
  return settleMaybe(() => dialog() !== null && inDialog(name) !== null, 5000);
}

describe("card-merge-pr-ui: a card merges its open PR from the card (#1196)", () => {
  test("a PR is offered for merging when it is open and its checks are not failing", () => {
    const can = (over: Partial<Card>) => canMergeCardPr(card(over));
    expect([
      can({}),
      can({ checksState: "pending" }),
      can({ checksState: null }),
      can({ checksState: "failing" }),
      can({ prState: "merged" }),
      can({ prState: "closed" }),
      can({ prUrl: null }),
    ]).toEqual([true, true, true, false, false, false, false]);
  });

  test("the dialog shows the PR's address and its checks, and nothing is sent before the confirm", async () => {
    const { view, sent } = setup();
    render(view);
    const shown = await opened("Merge PR");
    const says = dialog()?.textContent ?? "";
    expect([shown, says.includes(PR_URL), says.includes("checks passing"), sent.length]).toEqual([
      true,
      true,
      true,
      0,
    ]);
  });

  test("the confirm sends the merge with the confirm flag, a merge commit unless squash was chosen", async () => {
    const plain = setup();
    render(plain.view);
    await opened("Merge PR");
    await click(inDialog("Merge PR"));
    await settleMaybe(() => plain.sent.length === 1, 5000);
    cleanup();
    const squash = setup();
    render(squash.view);
    await opened("Merge PR");
    const choice = within(dialog() as HTMLElement).queryByLabelText("How to merge");
    if (choice) await act(async () => fireEvent.change(choice, { target: { value: "squash" } }));
    await click(inDialog("Merge PR"));
    await settleMaybe(() => squash.sent.length === 1, 5000);
    expect([plain.sent, squash.sent, plain.closed]).toEqual([
      [["card.pr.merge", { cardId: "c1", method: "merge", confirm: true }]],
      [["card.pr.merge", { cardId: "c1", method: "squash", confirm: true }]],
      [false],
    ]);
  });

  test("Cancel closes the dialog and sends nothing", async () => {
    const { view, sent, closed } = setup();
    render(view);
    await opened("Merge PR");
    await click(inDialog("Cancel"));
    expect([sent.length, closed]).toEqual([0, [false]]);
  });

  test("a refusal says why in place, with the reason's own text and a link that opens the PR", async () => {
    const { view, opened: links } = setup({
      answer: {
        ok: false,
        code: "invalid_state",
        message: "the PR could not be merged",
        reason: "card_pr_checks_failing",
        params: { url: PR_URL },
      },
    });
    render(view);
    await opened("Merge PR");
    await click(inDialog("Merge PR"));
    const shown = await settleMaybe(
      () => screen.queryAllByRole("alert").some((box) => (box.textContent ?? "") !== ""),
      5000,
    );
    const alert = screen.queryAllByRole("alert").find((box) => (box.textContent ?? "") !== "");
    const link = alert ? within(alert).queryByRole("link", { name: "Open the PR" }) : null;
    const focused = await settleMaybe(() => document.activeElement === alert, 2000);
    await click(link);
    expect([
      shown,
      focused,
      alert?.textContent?.includes("Checks are failing or still running"),
      dialog(),
      links,
    ]).toEqual([true, true, true, null, [PR_URL]]);
  });

  test("while a merge is under way the confirm is off, so one PR is never merged twice", async () => {
    const hang = Promise.withResolvers<Answer>();
    const { store, sent } = setup();
    store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
      sent.push([type, payload]);
      return hang.promise;
    }) as never;
    // A parent that keeps the dialog on screen shows what a second try would meet.
    render(
      <TContext.Provider value={store.i18n.t}>
        <CardMergePr store={store} hostId="h1" card={card()} open onOpenChange={() => {}} />
      </TContext.Provider>,
    );
    await opened("Merge PR");
    await click(inDialog("Merge PR"));
    const off = await settleMaybe(
      () => inDialog("Merge PR")?.hasAttribute("disabled") === true,
      3000,
    );
    await click(inDialog("Merge PR"));
    hang.resolve({ ok: true, data: card({ prState: "merged" }) });
    expect([off, sent.length]).toEqual([true, 1]);
  });

  test("a refusal goes away when the PR is no longer open", async () => {
    const { store } = setup({
      answer: { ok: false, code: "invalid_state", message: "x", reason: "card_pr_conflict" },
    });
    const tree = (current: Card) => (
      <Harness store={store} card={current} onOpenChange={() => {}} />
    );
    const view = render(tree(card()));
    await opened("Merge PR");
    await click(inDialog("Merge PR"));
    const shown = await settleMaybe(
      () =>
        screen.queryAllByRole("alert").some((box) => (box.textContent ?? "").includes("conflicts")),
      3000,
    );
    view.rerender(tree(card({ prState: "merged" })));
    const gone = await settleMaybe(
      () => screen.queryAllByRole("alert").every((box) => (box.textContent ?? "") === ""),
      3000,
    );
    expect([shown, gone]).toEqual([true, true]);
  });

  test("a merged PR says so, and the pt-BR dialog is in Portuguese", async () => {
    const english = setup();
    render(english.view);
    await opened("Merge PR");
    await click(inDialog("Merge PR"));
    const merged = await settleMaybe(
      () =>
        screen.queryAllByRole("status").some((box) => (box.textContent ?? "").includes("merged")),
      5000,
    );
    cleanup();
    const portuguese = setup({ language: "pt-BR" });
    render(portuguese.view);
    const shown = await settleMaybe(
      () => dialog() !== null && inDialog("Fazer merge do PR") !== null,
      5000,
    );
    expect([merged, shown, dialog()?.textContent?.includes("Como fazer o merge")]).toEqual([
      true,
      true,
      true,
    ]);
  });
});
