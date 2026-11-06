import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";
import { workflowDaemon } from "./workflow-fixtures.ts";

registerDom();
const { act, cleanup, within } = await import("@testing-library/react");
const { render } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, needsYou } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(8000);

const YAML = `steps:
  - id: plan
    agent: { prompt: plano }
  - id: approve
    gate: { message: "Aprovar o plano?", show: "{{steps.plan.output}}" }
  - id: implement
    agent: { prompt: "implemente: {{steps.approve.output}}" }
`;

describe("gate-top: a card's waiting gate is the first thing on the card", () => {
  // Issue #227 (OpenCode R5a): the gate's Approve and Reject sat under the whole form, below the
  // fold, so "Abrir card" from Needs you landed on an edit form.
  test("opened from Needs you, the card shows its waiting gate once, above the Details panel", async () => {
    const d = await workflowDaemon(cleanups, { wf: YAML });
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.server.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const card = d.board.createCard(d.project.id, { title: "Somar", description: "x" });
    await d.board.startCard(card.id, { workflow: "wf" });
    await settle(() => needsYou(store.getState()).length === 1);
    const hostId = store.getState().hosts[0]?.id ?? "";
    await act(async () => {
      store.router.push({ name: "card", host: hostId, projectId: d.project.id, cardId: card.id });
    });
    await settle(() => screen.queryAllByRole("region", { name: "Gate approve" }).length > 0);
    const gates = screen.queryAllByRole("region", { name: "Gate approve" });
    expect(gates).toHaveLength(1);
    const details = screen.queryByRole("region", { name: "Detalhes" }) as HTMLElement;
    expect(details).not.toBeNull();
    const before = (gates[0] as HTMLElement).compareDocumentPosition(details);
    expect(before & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
