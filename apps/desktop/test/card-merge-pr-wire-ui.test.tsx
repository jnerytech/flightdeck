import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { personasHost } from "./personas-ui-setup.ts";
import { settle, settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #1196, from the card's own screen: the card of a host that merges shows Merge PR when its
 * PR is open and its checks are not failing; the button opens the confirm and nothing is sent
 * before it. Against a real daemon, pt-BR (the app's default language).
 */
const PR_URL = "https://github.com/acme/repo/pull/9";

async function openCard(pr: { state: string; checks: string | null }) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const { d, hostId, projectId } = await personasHost(cleanups, store);
  const card = d.board.createCard(projectId, {
    title: "Somar o total",
    description: "O total erra.",
  });
  d.eventStore.db
    .query(
      "UPDATE cards SET pr_url = ?, pr_state = ?, checks_state = ?, board_column = 'review' WHERE id = ?",
    )
    .run(PR_URL, pr.state, pr.checks, card.id);
  render(<App store={store} />);
  await act(async () => {
    store.router.push({ name: "card", host: hostId, projectId, cardId: card.id });
  });
  await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
  await act(async () => {
    await store.hostCommand(hostId, "card.get", { cardId: card.id });
  });
  return { store, hostId, cardId: card.id };
}

const merge = () => screen.queryByRole("button", { name: "Fazer merge do PR" });

describe("card-merge-pr-wire-ui: Merge PR on the card's screen (#1196)", () => {
  test("an open PR with passing checks shows Merge PR, which opens the confirm with the PR's address, and Cancelar sends nothing", async () => {
    await openCard({ state: "open", checks: "passing" });
    const shown = await settleMaybe(() => merge() !== null, 4000);
    if (merge()) {
      await act(async () => {
        fireEvent.click(merge() as HTMLElement);
      });
    }
    const asked = await settleMaybe(() => screen.queryByRole("alertdialog") !== null, 4000);
    const says = screen.queryByRole("alertdialog")?.textContent ?? "";
    const cancel = screen.queryByRole("button", { name: "Cancelar" });
    if (cancel) {
      await act(async () => {
        fireEvent.click(cancel);
      });
    }
    expect([
      shown,
      asked,
      says.includes(PR_URL),
      screen.queryByRole("alertdialog") === null,
    ]).toEqual([true, true, true, true]);
  });

  test("a PR whose checks fail, and one already merged, show no Merge PR", async () => {
    await openCard({ state: "open", checks: "failing" });
    await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
    const failing = merge() === null;
    cleanup();
    await openCard({ state: "merged", checks: "passing" });
    await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
    expect([failing, merge() === null]).toEqual([true, true]);
  });
});
