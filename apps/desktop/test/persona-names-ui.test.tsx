import { afterEach, describe, expect, test } from "bun:test";
import type { SessionNameInfo, TeamMember } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TeamMemberRow } = await import("../src/ui/TeamsPage.tsx");
const { NeedsYou } = await import("../src/ui/NeedsYou.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

afterEach(cleanup);

/**
 * Issue #101, the team screen: a member's row names it by its persona in the person's language,
 * links the name to its session, shows the persona's name instead of its slug, keeps the session
 * id behind a copy button, and lines the persona picker up with its buttons.
 */
const SESSION = "01JABCDEFGHJKMNPQRSTVWXYZ0";

const WORKER: TeamMember = {
  name: "md-server · executora 1",
  role: "worker",
  persona: "qa",
  model: null,
  cardId: "c1",
  sessionId: SESSION,
  address: `pc/${SESSION}`,
  sessionState: "running",
  number: 1,
};

const NAME: SessionNameInfo = {
  sessionId: SESSION,
  display: "app · qa · card 1",
  alias: "app-qa-card-1",
  aliases: ["app-qa-card-1"],
  project: "app",
  persona: "qa",
  number: 1,
  cardNumber: 1,
  standard: true,
  team: { name: "md-server", role: "worker", number: 1 },
};

function setup(lang: "en" | "pt-BR") {
  const mem = memoryPlatform(false, lang);
  const copied: string[] = [];
  mem.platform.copyText = async (text) => void copied.push(text);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const persona = lang === "en" ? "QA engineer" : "Engenheira de QA";
  (store as unknown as { update(p: object): void }).update({
    names: { h1: [NAME] },
    personas: { h1: [{ id: "qa", name: persona, description: "", scope: "pack" }] },
  });
  render(
    <TContext.Provider value={store.i18n.t}>
      <TooltipProvider>
        <ul>
          <TeamMemberRow
            store={store}
            hostId="h1"
            projectId="p1"
            member={WORKER}
            report={null}
            open
            onPersona={async () => true}
            onRemove={() => {}}
          />
        </ul>
      </TooltipProvider>
    </TContext.Provider>,
  );
  return { store, copied, persona };
}

const press = async (button: HTMLElement | null) => {
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

describe("persona-names-ui: a team member's row (#101)", () => {
  for (const [lang, label, copy] of [
    ["en", "md-server · QA engineer 1", "Copy the session id of md-server · QA engineer 1"],
    [
      "pt-BR",
      "md-server · Engenheira de QA 1",
      "Copiar o id da sessão de md-server · Engenheira de QA 1",
    ],
  ] as const) {
    test(`names the member by its persona, links the name to its session and copies its id (${lang})`, async () => {
      const { store, copied, persona } = setup(lang);
      const row = document.querySelector('[data-slot="team-member"]');
      const text = row?.textContent ?? "";
      const badges = [...(row?.querySelectorAll('[data-slot="badge"]') ?? [])].map(
        (badge) => badge.textContent,
      );
      const facts = [
        text.includes(label),
        text.includes(WORKER.name),
        badges.includes(persona),
        badges.includes("qa"),
        text.includes(SESSION),
      ];
      await press(screen.queryByRole("button", { name: label }));
      const route = store.router.current as { name: string; id?: string };
      await press(screen.queryByRole("button", { name: copy }));
      expect([...facts, route.name, route.id, copied]).toEqual([
        true,
        false,
        true,
        false,
        false,
        "session",
        SESSION,
        [SESSION],
      ]);
    });
  }

  test("the persona picker and its buttons sit on the shared field row", () => {
    setup("en");
    const row = document.querySelector('[data-slot="member-persona"]');
    const buttons = [/^Change the persona of /, /^Remove /].map(
      (name) => within(row as HTMLElement).queryByRole("button", { name }) !== null,
    );
    expect([row?.classList.contains("field-row") ?? false, ...buttons]).toEqual([true, true, true]);
  });
});

describe("persona-names-ui: the Needs you screen (#101)", () => {
  test("a request waiting on a team session names it by its persona", () => {
    const mem = memoryPlatform(false, "pt-BR");
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    (store as unknown as { update(p: object): void }).update({
      hosts: [
        {
          id: "h1",
          name: "alfa",
          status: "online",
          sessions: [
            {
              id: SESSION,
              name: WORKER.name,
              cwd: "/p/app",
              status: "running",
              pendingPermissions: [
                { requestId: "r1", toolName: "Bash", createdAt: "2026-11-06T10:00:00.000Z" },
              ],
            },
          ],
        },
      ],
      names: { h1: [NAME] },
      personas: { h1: [{ id: "qa", name: "Engenheira de QA", description: "", scope: "pack" }] },
    });
    render(
      <TContext.Provider value={store.i18n.t}>
        <TooltipProvider>
          <NeedsYou store={store} state={store.getState()} go={() => {}} onOpenRequest={() => {}} />
        </TooltipProvider>
      </TContext.Provider>,
    );
    const text = document.body.textContent ?? "";
    expect([text.includes("md-server · Engenheira de QA 1"), text.includes(WORKER.name)]).toEqual([
      true,
      false,
    ]);
  });
});
