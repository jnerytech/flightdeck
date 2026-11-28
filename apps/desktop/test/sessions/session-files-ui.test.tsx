import { afterEach, describe, expect, test } from "bun:test";
import type { SessionFile } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { settleMaybe } = await import("../wait.ts");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");
const { SessionFiles } = await import("../../src/features/files/session-files.tsx");

afterEach(cleanup);

/**
 * #1128: under the session's diff, the Changes tab said "The session has not written any file
 * yet." while the diff above listed two changed files. The block is the session's own Write and
 * Edit calls, another source than the diff: it now says so in its heading, and its empty line
 * reads true whatever the diff shows.
 */
function show(language: "en" | "pt-BR", files: SessionFile[]) {
  const store = {
    hostCommand: async () => ({ files }),
    formatDateTime: () => "today",
  };
  render(
    <TContext.Provider value={translator(language)}>
      <SessionFiles store={store as never} hostId="h" claudeSessionId="s" />
    </TContext.Provider>,
  );
}

describe("session-files-ui: the session's own files say where they come from (#1128)", () => {
  for (const [language, names] of [
    [
      "en",
      {
        title: "Files the session edited directly (Write, Edit)",
        none: "None yet. Changes made by commands (Bash) or outside the session are not listed here.",
        old: "The session has not written any file yet.",
        bash: "Changes made through Bash do not count.",
      },
    ],
    [
      "pt-BR",
      {
        title: "Arquivos que a sessão editou direto (Write, Edit)",
        none: "Nenhum ainda. Mudanças feitas por comandos (Bash) ou fora da sessão não aparecem aqui.",
        old: "A sessão ainda não escreveu arquivos.",
        bash: "Mudanças feitas pelo Bash não entram.",
      },
    ],
  ] as const) {
    test(`${language}: with none, a titled block says where the changes above came from, not that nothing was written`, async () => {
      show(language, []);
      await waitFor(() =>
        expect(screen.queryByRole("region", { name: names.title })).not.toBeNull(),
      );
      const region = within(screen.queryByRole("region", { name: names.title }) as HTMLElement);
      expect([
        region.queryByText(names.none) !== null,
        region.queryByText(names.old) === null,
        region.queryByText(names.bash) === null,
      ]).toEqual([true, true, true]);
    });

    test(`${language}: with files, the titled block lists them and keeps the Bash note`, async () => {
      show(language, [
        {
          path: "src/app.ts",
          edits: 2,
          firstAt: "2026-11-08T09:00:00.000Z",
          lastAt: "2026-11-08T10:00:00.000Z",
        },
      ]);
      await waitFor(() =>
        expect(screen.queryByRole("region", { name: names.title })).not.toBeNull(),
      );
      const region = within(screen.queryByRole("region", { name: names.title }) as HTMLElement);
      expect([
        region.queryByText("src/app.ts") !== null,
        region.queryByText(names.bash) !== null,
      ]).toEqual([true, true]);
    });
  }
});

/**
 * #4489: a refused `session.files` came back as `null` and the block said "None yet.", as if the
 * session had written nothing. It now says the files could not be read, with Try again.
 */
const FILE = {
  path: "src/app.ts",
  edits: 2,
  firstAt: "2026-11-08T09:00:00.000Z",
  lastAt: "2026-11-08T10:00:00.000Z",
};

/** A store whose `hostCommand` answers in turn: a list, or null for a refusal. */
function showAnswers(language: "en" | "pt-BR", answers: (SessionFile[] | null)[]) {
  let asked = 0;
  const store = {
    hostCommand: async () => {
      const answer = answers[Math.min(asked, answers.length - 1)] ?? null;
      asked += 1;
      return answer === null ? null : { files: answer };
    },
    formatDateTime: () => "today",
  };
  render(
    <TContext.Provider value={translator(language)}>
      <SessionFiles store={store as never} hostId="h" claudeSessionId="s" />
    </TContext.Provider>,
  );
  return { asked: () => asked };
}

describe("session-files-ui: a refused read is not an empty list (#4489)", () => {
  for (const [language, names] of [
    [
      "en",
      {
        failed: "The session's files could not be read.",
        none: "None yet. Changes made by commands (Bash) or outside the session are not listed here.",
        retry: "Try again",
      },
    ],
    [
      "pt-BR",
      {
        failed: "Não foi possível ler os arquivos da sessão.",
        none: "Nenhum ainda. Mudanças feitas por comandos (Bash) ou fora da sessão não aparecem aqui.",
        retry: "Tentar de novo",
      },
    ],
  ] as const) {
    test(`${language}: a refused read says the files could not be read, with Try again, not None yet`, async () => {
      showAnswers(language, [null]);
      expect(
        await settleMaybe(() => screen.queryByRole("button", { name: names.retry }) !== null, 3000),
      ).toBe(true);
      expect([
        screen.queryByRole("alert")?.textContent?.includes(names.failed) ?? false,
        screen.queryByText(names.none) === null,
      ]).toEqual([true, true]);
    });
  }

  test("Try again asks the host again and lists the files it answers with", async () => {
    const page = showAnswers("en", [null, [FILE]]);
    expect(
      await settleMaybe(() => screen.queryByRole("button", { name: "Try again" }) !== null, 3000),
    ).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await settleMaybe(() => screen.queryByText("src/app.ts") !== null, 3000)).toBe(true);
    expect([page.asked(), screen.queryByRole("alert") === null]).toEqual([2, true]);
  });

  test("Try again keeps the focus on its button while the host is asked again", async () => {
    const page = showAnswers("en", [null]);
    expect(
      await settleMaybe(() => screen.queryByRole("button", { name: "Try again" }) !== null, 3000),
    ).toBe(true);
    (screen.getByRole("button", { name: "Try again" }) as HTMLElement).focus();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await settleMaybe(() => page.asked() === 2, 3000)).toBe(true);
    await settleMaybe(() => false, 300);
    expect(document.activeElement === screen.queryByRole("button", { name: "Try again" })).toBe(
      true,
    );
  });

  test("a host that answers with no files still says None yet", async () => {
    showAnswers("en", [[]]);
    expect(
      await settleMaybe(
        () =>
          screen.queryByText(
            "None yet. Changes made by commands (Bash) or outside the session are not listed here.",
          ) !== null,
        3000,
      ),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
