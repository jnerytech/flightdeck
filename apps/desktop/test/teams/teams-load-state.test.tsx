import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TeamsPage } = await import("../../src/features/teams/page.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Answer = "empty" | "fail" | "hang";

const WORDS = {
  en: {
    loading: "Loading teams",
    empty: "No teams yet",
    first: "Create the first team",
    retry: "Try again",
    failed: "The teams did not load.",
  },
  "pt-BR": {
    loading: "Carregando os times",
    empty: "Nenhum time ainda",
    first: "Criar o primeiro time",
    retry: "Tentar de novo",
    failed: "Os times não carregaram.",
  },
};

/**
 * #2647: the page opened with `teams` empty, so "No teams yet" and "Create the first team" showed
 * before `teams.list` answered. `answers` is what each `teams.list` call gets, in order; after the
 * last, the host answers an empty list.
 */
async function openTeams(language: "en" | "pt-BR", answers: Answer[]) {
  const queue = [...answers];
  let lists = 0;
  const host = await fakeHostStore(
    {
      "teams.list": () => {
        lists += 1;
        const answer = queue.shift() ?? "empty";
        if (answer === "hang") return new Promise(() => {});
        if (answer === "fail") throw new RequestError("internal", "host is down");
        return { teams: [] };
      },
    },
    { hostId: "h1", features: ["teams"], language, fallback: null },
  );
  host.store.i18n.start();
  host.store.projectList.load = async () => null;
  render(
    <TooltipProvider>
      <TeamsPage store={host.store} go={() => {}} />
    </TooltipProvider>,
  );
  return { lists: () => lists, words: WORDS[language] };
}

const text = (value: string) => screen.queryByText(value) !== null;
const button = (name: string) => screen.queryByRole("button", { name }) !== null;

describe.each(["en", "pt-BR"] as const)("teams-load-state (%s)", (language) => {
  test("before the host answers the list, the page shows the loading shape, not the empty state", async () => {
    const { words } = await openTeams(language, ["hang"]);
    await settleMaybe(() => screen.queryByRole("status", { name: words.loading }) !== null, 3000);
    expect(screen.queryByRole("status", { name: words.loading }) !== null).toBe(true);
    expect(text(words.empty)).toBe(false);
    expect(button(words.first)).toBe(false);
  });

  test("an answered empty list shows the empty state and offers the first team", async () => {
    const { words } = await openTeams(language, ["empty"]);
    await settleMaybe(() => text(words.empty), 3000);
    expect(text(words.empty)).toBe(true);
    expect(button(words.first)).toBe(true);
    expect(screen.queryByRole("status", { name: words.loading }) !== null).toBe(false);
  });

  test("a failed list shows an error with a retry, not the empty state", async () => {
    const { words } = await openTeams(language, ["fail"]);
    await settleMaybe(() => button(words.retry), 3000);
    expect(button(words.retry)).toBe(true);
    expect(screen.queryByRole("alert")?.textContent).toContain(words.failed);
    expect(text(words.empty)).toBe(false);
    expect(button(words.first)).toBe(false);
    expect(screen.queryByRole("status", { name: words.loading }) !== null).toBe(false);
  });

  test("the retry asks the host again and, once it answers, shows the list", async () => {
    const page = await openTeams(language, ["fail", "empty"]);
    await settleMaybe(() => button(page.words.retry), 3000);
    expect(button(page.words.retry)).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: page.words.retry }));
    });
    await settleMaybe(() => text(page.words.empty), 3000);
    expect(text(page.words.empty)).toBe(true);
    expect(page.lists()).toBe(2);
    expect(button(page.words.retry)).toBe(false);
  });
});
