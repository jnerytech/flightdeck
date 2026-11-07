import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { useState } = await import("react");
const { SessionTabs } = await import("../src/ui/SessionTabs.tsx");
const { SessionViews } = await import("../src/lib/session-views.ts");

afterEach(cleanup);

/** A conversation with a draft in its box, standing in for the session view. */
function Conversation() {
  const [draft, setDraft] = useState("");
  return <textarea aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />;
}

// The page tells the store its views: nothing else of the store is read here.
const store = { sessionViews: new SessionViews() } as never;
const tabs = (claudeSessionId: string | null) => (
  <SessionTabs store={store} hostId="h" claudeSessionId={claudeSessionId} enabled>
    <Conversation />
  </SessionTabs>
);

describe("sessao-abas-estavel: the conversation is not rebuilt when the tabs appear", () => {
  test("a draft typed before Claude Code names the session is still there when the Mudanças tab shows up", () => {
    const view = render(tabs(null));
    expect(screen.queryByRole("tab", { name: "Mudanças" })).toBeNull();
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "/rev" } });
    view.rerender(tabs("c-1"));
    expect(screen.queryByRole("tab", { name: "Mudanças" })).not.toBeNull();
    expect((screen.getByLabelText("draft") as HTMLTextAreaElement).value).toBe("/rev");
  });
});
