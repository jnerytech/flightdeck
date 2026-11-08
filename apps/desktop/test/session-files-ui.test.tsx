import { afterEach, describe, expect, test } from "bun:test";
import type { SessionFile } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { SessionFiles } = await import("../src/ui/SessionFiles.tsx");

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
        title: "Files the session wrote with its own tools",
        none: "None yet. Changes made by commands (Bash) or outside the session show only in the changes above.",
        old: "The session has not written any file yet.",
        bash: "Changes made through Bash do not count.",
      },
    ],
    [
      "pt-BR",
      {
        title: "Arquivos que a sessão escreveu com as próprias ferramentas",
        none: "Nenhum ainda. Mudanças feitas por comandos (Bash) ou fora da sessão aparecem só nas mudanças acima.",
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
