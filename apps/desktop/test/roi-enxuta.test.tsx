import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { en } from "../src/i18n/en.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { renderProbe } from "./render-probe.tsx";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { useStoreSlice } = await import("../src/lib/use-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { AppStore } = await import("../src/lib/app-store.ts");
const { RoiCard } = await import("../src/components/roi/roi-card.tsx");
const { RoiTable } = await import("../src/components/roi/roi-table.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(10_000);

/** Something on other state: a ROI refresh must not render it. */
function Other(props: { store: InstanceType<typeof AppStore> }) {
  const { hosts } = useStoreSlice(props.store, ["hosts"]);
  return <p>{`hosts: ${hosts.length}`}</p>;
}

describe("roi-enxuta: a roi.summary refresh renders the card and the table, nothing else", () => {
  test("the figures load without touching the store, so a component on other state stays quiet", async () => {
    const d = makeDaemon(cleanups, { roi: true });
    const repo = join(d.root, "shop");
    mkdirSync(repo, { recursive: true });
    await Bun.spawn(["git", "init", "-q", repo]).exited;
    const store = new AppStore(memoryPlatform(false, "en").platform, {
      baseDelayMs: 60_000,
      now: () => Date.parse("2026-10-14T12:00:00Z"),
      day: (ms) => new Date(ms).toISOString().slice(0, 10),
    });
    cleanups.push(() => store.dispose());
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id ?? "";
    const project = await store.hostCommand(hostId, "project.add", { path: repo });
    if (!project) throw new Error("no project");

    const cardProbe = renderProbe("card");
    const tableProbe = renderProbe("table");
    const otherProbe = renderProbe("other");
    // The table's range lives in a holder of its own: changing it must not render the others.
    const range: { set?: (to: string) => void } = {};
    function Holder() {
      const [to, setTo] = useState("2026-10-14");
      range.set = setTo;
      return (
        <RoiTable
          store={store}
          hostIds={[hostId]}
          from="2026-10-01"
          to={to}
          selection="all"
          projectName={(key) => key}
        />
      );
    }
    const tree = (
      <TContext.Provider value={translator("en")}>
        {cardProbe.wrap(<RoiCard store={store} hostId={hostId} project={project} />)}
        {tableProbe.wrap(<Holder />)}
        {otherProbe.wrap(<Other store={store} />)}
      </TContext.Provider>
    );
    render(tree);
    await settle(() => screen.queryByText(en.roiUi.title) !== null);
    await settle(
      () =>
        screen.queryByText(en.roiUi.table.empty) !== null || screen.queryByRole("table") !== null,
    );
    const [card, table, other] = [
      cardProbe.snapshot(),
      tableProbe.snapshot(),
      otherProbe.snapshot(),
    ];
    const stateBefore = store.getState();

    // The card loads again on a new period, the table on a new range.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.roiUi.period7 }));
    });
    await act(async () => {
      range.set?.("2026-10-13");
    });
    await act(async () => {
      await store.roiSummaries("2026-10-01", "2026-10-14");
    });

    expect(cardProbe.since(card).commits).toBeGreaterThan(0);
    expect(tableProbe.since(table).commits).toBeGreaterThan(0);
    expect(otherProbe.since(other).commits).toBe(0);
    expect(store.getState()).toBe(stateBefore);
  });
});
