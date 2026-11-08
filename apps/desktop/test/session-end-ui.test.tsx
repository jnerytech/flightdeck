import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { translator } = await import("../src/i18n/index.ts");
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");

afterEach(cleanup);

/**
 * Issue #1133, slice A2: End on a plain session first asks about the files its checkout has not
 * committed. Commit… goes to its Changes, End anyway ends it with the files where they are, Cancel
 * leaves it running. With nothing uncommitted, End confirms as it always did.
 */
function setup(
  lang: "en" | "pt-BR",
  uncommitted: number,
  mode: "full" | "simple" = "full",
  count: () => Promise<number> = async () => uncommitted,
) {
  const did: string[] = [];
  const actions = {
    send: async () => {},
    interrupt: async () => {},
    close: async () => {
      did.push("close");
    },
    resume: async () => {},
    respond: async () => {},
    copyText: async () => true,
  };
  render(
    <SessionView
      t={translator(lang, mode)}
      title="s"
      session={{ ...emptySession(), status: "idle" as const }}
      actions={actions}
      uncommitted={count}
      onCommitFirst={() => did.push("changes")}
    />,
  );
  return did;
}

const press = async (button: HTMLElement | null) => {
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const NAMES = {
  en: {
    end: "End",
    many: "2 files in this session's checkout are not committed. Commit them first, or end anyway and leave them as they are.",
    simple: {
      end: "Stop the task",
      many: "2 files this task changed are not saved yet. Save them first, or stop anyway and leave them as they are.",
      commit: "Save…",
      anyway: "Stop anyway",
    },
    commit: "Commit…",
    anyway: "End anyway",
    cancel: "Cancel",
    plain: "End this session? Claude Code stops; you can resume it later.",
  },
  "pt-BR": {
    end: "Encerrar",
    many: "2 arquivos no checkout desta sessão não estão commitados. Faça o commit antes, ou encerre assim mesmo e deixe como estão.",
    simple: {
      end: "Parar a tarefa",
      many: "2 arquivos que a tarefa mudou ainda não foram salvos. Salve antes, ou pare assim mesmo e deixe como estão.",
      commit: "Salvar…",
      anyway: "Parar assim mesmo",
    },
    commit: "Fazer commit…",
    anyway: "Encerrar assim mesmo",
    cancel: "Cancelar",
    plain: "Encerrar esta sessão? O Claude Code para; dá para retomá-la depois.",
  },
} as const;

const dialog = () => screen.queryByRole("alertdialog") as HTMLElement | null;
const inDialog = (name: string) =>
  dialog() ? within(dialog() as HTMLElement).queryByRole("button", { name }) : null;

describe("session-end-ui: End asks about the files the session did not commit (#1133)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    const n = NAMES[lang];

    test(`${lang}: with uncommitted files, Commit… goes to the changes, Cancel keeps it, End anyway ends it`, async () => {
      const did = setup(lang, 2);
      await press(screen.queryByRole("button", { name: n.end }));
      const asked = dialog() !== null && screen.queryByText(n.many) !== null;
      await press(inDialog(n.commit));
      const afterCommit = [...did];
      await press(screen.queryByRole("button", { name: n.end }));
      await press(inDialog(n.cancel));
      const afterCancel = [...did];
      await press(screen.queryByRole("button", { name: n.end }));
      await press(inDialog(n.anyway));
      expect([asked, afterCommit, afterCancel, did]).toEqual([
        true,
        ["changes"],
        ["changes"],
        ["changes", "close"],
      ]);
    });

    test(`${lang}: with nothing uncommitted, End confirms as before`, async () => {
      setup(lang, 0);
      await press(screen.queryByRole("button", { name: n.end }));
      expect([screen.queryByText(n.plain) !== null, inDialog(n.anyway) === null]).toEqual([
        true,
        true,
      ]);
    });

    test(`${lang}: simple mode asks in its own words`, async () => {
      setup(lang, 2, "simple");
      await press(screen.queryByRole("button", { name: n.simple.end }));
      expect([
        screen.queryByText(n.simple.many) !== null,
        inDialog(n.simple.commit) !== null,
        inDialog(n.simple.anyway) !== null,
      ]).toEqual([true, true, true]);
    });

    test(`${lang}: End is busy while it counts the files`, async () => {
      let answer = (_n: number) => {};
      setup(lang, 0, "full", () => new Promise<number>((resolve) => (answer = resolve)));
      await press(screen.queryByRole("button", { name: n.end }));
      const busy = screen.queryByRole("button", { name: n.end })?.hasAttribute("disabled");
      await act(async () => answer(0));
      expect([busy, screen.queryByText(n.plain) !== null]).toEqual([true, true]);
    });
  }
});
