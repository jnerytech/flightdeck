import { afterEach, describe, expect, test } from "bun:test";
import type { TeamMember } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TeamMemberRow } = await import("../../src/features/teams/team-member-row.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");

afterEach(cleanup);

const WORKER: TeamMember = {
  name: "login · executora 2",
  role: "worker",
  persona: null,
  model: null,
  cardId: "c2",
  sessionId: null,
  address: null,
  sessionState: null,
  number: 2,
};

function show(language: "en" | "pt-BR", member: TeamMember) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  render(
    <TContext.Provider value={store.i18n.t}>
      <TooltipProvider>
        <ul>
          <TeamMemberRow
            store={store}
            hostId="h1"
            projectId="p1"
            member={member}
            report={null}
            open
            onPersona={async () => true}
            onRemove={() => {}}
          />
        </ul>
      </TooltipProvider>
    </TContext.Provider>,
  );
}

const WORDS = {
  en: { waiting: "Waiting for a session", running: "Running" },
  "pt-BR": { waiting: "Aguardando uma sessão", running: "Rodando" },
} as const;

// Issue #4022: a worker whose card waits for a session says so where its state shows.
describe.each(["en", "pt-BR"] as const)("teams: a worker with no session yet (%s)", (language) => {
  const w = WORDS[language];
  const end = () => screen.getByRole("listitem").querySelector("[data-slot='member-end']");

  test("the state place says it waits for a session", () => {
    show(language, WORKER);
    expect(end()?.textContent).toContain(w.waiting);
  });

  test("a member with a session shows its state and not the waiting word", () => {
    show(language, { ...WORKER, sessionId: "01JABCDEFGHJKMNPQRSTVWXYZ0", sessionState: "running" });
    expect(end()?.textContent).toContain(w.running);
    expect(end()?.textContent).not.toContain(w.waiting);
  });

  test("a real state is never hidden by the waiting word, even with no session id", () => {
    show(language, { ...WORKER, sessionState: "running" });
    expect(end()?.textContent).toContain(w.running);
    expect(end()?.textContent).not.toContain(w.waiting);
  });
});
