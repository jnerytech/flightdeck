import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ExternalPermissionFrame, ExternalSession } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { ExternalView } = await import("../../src/features/sessions/external-session-view.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

/**
 * Issue #2316: a "Claude asks" card taller than the pane could not be reached. happy-dom has no
 * layout, so this reads the class names of what holds the card; the e2e `layout` journey is the
 * real-browser check.
 */
setDefaultTimeout(20_000);
afterEach(cleanup);

const ID = "eeeeeeee-0000-4000-8000-000000002316";

const question = (n: number) => ({
  question: `Question ${n}?`,
  header: `Q${n}`,
  multiSelect: false,
  options: [1, 2, 3, 4].map((o) => ({ label: `Option ${n}.${o}`, description: "" })),
});

function view(requests: ExternalPermissionFrame[]) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
  store.i18n.start();
  const session: ExternalSession = {
    claudeSessionId: ID,
    cwd: "/work/api",
    transcriptPath: null,
    source: "startup",
    status: "idle",
    statusReason: null,
    launchId: null,
    controllable: false,
    projectKey: null,
    startedAt: "2026-11-12T10:00:00.000Z",
    lastEventAt: "2026-11-12T10:00:00.000Z",
    endedAt: null,
  };
  const state = {
    ...store.getState(),
    externals: { [`h1/${ID}`]: session },
    externalRequests: Object.fromEntries(requests.map((r) => [`h1/${r.requestId}`, r])),
  };
  render(
    <TContext.Provider value={store.i18n.t}>
      <ExternalView
        store={store}
        state={state}
        hostId="h1"
        hostName="pc"
        claudeSessionId={ID}
        onResumed={() => {}}
      />
    </TContext.Provider>,
  );
}

const ask: ExternalPermissionFrame = {
  type: "external.permission",
  requestId: "ext-ask",
  claudeSessionId: ID,
  toolName: "AskUserQuestion",
  input: { questions: [question(1), question(2), question(3)] },
  state: "open",
  createdAt: "2026-11-12T10:00:00Z",
};

describe("external-session-ask-scroll: a tall question card scrolls (#2316)", () => {
  test("the area that holds the cards is a scroll container with a height limit, so the transcript keeps room", () => {
    view([ask]);
    const card = document.querySelector('[data-slot="approval-card"]') as HTMLElement;
    expect(card).not.toBeNull();
    const holder = card.parentElement as HTMLElement;
    const classes = holder.className.split(/\s+/);
    expect(classes).toContain("overflow-y-auto");
    expect(classes.some((c) => c.startsWith("max-h-"))).toBe(true);
  });

  test("with no card waiting the view shows no such area", () => {
    view([]);
    expect(document.querySelector('[data-slot="approval-card"]')).toBeNull();
    expect(screen.queryByText("Question 1?")).toBeNull();
  });
});
