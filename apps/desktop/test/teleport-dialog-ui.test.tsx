import { afterEach, describe, expect, test } from "bun:test";
import type { TeleportOutcome, TeleportSummary } from "../src/lib/teleport.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { settleMaybe, waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TeleportDialog } = await import("../src/ui/TeleportDialog.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { RequestError } = await import("../src/lib/host-connection.ts");

/**
 * Issue #100, slice 3b: the dialog that moves a session to another host. The person picks the host
 * and the repository, sees counts and sizes (never a secret), says yes, watches it go and opens it
 * on the other host; a refusal reads as the app's own text, never the host's message.
 */
afterEach(() => cleanup());
const settle = waiter(4000);

const SUMMARY: TeleportSummary = {
  branch: "feature/login",
  ahead: 3,
  changed: 2,
  bytes: 2048,
  secretLines: 1,
};

const TEXT = {
  en: {
    host: "Host",
    repo: "Repository on that host",
    next: "Continue",
    move: "Move",
    back: "Back",
    open: "Open it there",
    secrets: "Lines that look like secrets: 1",
    moving: "Moving… 50%",
    done: "The session is on pi now.",
    refused: "This repository is not the session's project",
  },
  "pt-BR": {
    host: "Host",
    repo: "Repositório nesse host",
    next: "Continuar",
    move: "Mover",
    back: "Voltar",
    open: "Abrir lá",
    secrets: "Linhas que parecem segredos: 1",
    moving: "Movendo… 50%",
    done: "A sessão está agora em pi.",
    refused: "Este repositório não é o projeto da sessão",
  },
} as const;

/**
 * The dialog with a fake run the test drives: the person's answers and the move's end. `held` keeps
 * the source preparing until the test calls `ready`.
 */
function open(lang: "en" | "pt-BR", summary: TeleportSummary = SUMMARY, held = false) {
  const calls = {
    opened: [] as string[][],
    closed: 0,
    args: [] as Array<{ target: string; repo: string }>,
  };
  const control: {
    confirm?: (summary: TeleportSummary) => Promise<boolean>;
    progress?: (sent: number, total: number) => void;
    finish?: (outcome: TeleportOutcome) => void;
    fail?: (error: unknown) => void;
    answer?: Promise<boolean>;
    signal?: AbortSignal;
    ready?: () => void;
  } = {};
  render(
    <TContext.Provider value={translator(lang)}>
      <TeleportDialog
        targets={[{ id: "h2", name: "pi" }]}
        repoField={(_hostId, value, onChange) => (
          <input aria-label="repo-path" value={value} onChange={(e) => onChange(e.target.value)} />
        )}
        run={(args) => {
          calls.args.push({ target: args.target, repo: args.repo });
          control.progress = args.onProgress;
          control.signal = args.signal;
          control.ready = () => {
            control.answer = args.confirm(summary);
          };
          if (!held) control.ready();
          return new Promise<TeleportOutcome>((resolve, reject) => {
            control.finish = resolve;
            control.fail = reject;
          });
        }}
        onOpen={(host, session) => calls.opened.push([host, session])}
        onClose={() => {
          calls.closed++;
        }}
      />
    </TContext.Provider>,
  );
  return { calls, control };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

/** Picks the host (the repository field is for that host), types the repository, continues. */
async function start(lang: "en" | "pt-BR") {
  const t = TEXT[lang];
  const host = screen.queryByRole("combobox", { name: t.host });
  expect(host).not.toBeNull();
  await act(async () => {
    fireEvent.change(host as HTMLElement, { target: { value: "h2" } });
  });
  const repo = screen.queryByRole("textbox", { name: "repo-path" });
  expect(repo).not.toBeNull();
  await act(async () => {
    fireEvent.change(repo as HTMLElement, { target: { value: "/work/app" } });
  });
  await click(t.next);
}

const shows = (text: string) =>
  settle(() => (document.body.textContent ?? "").includes(text)).then(
    () => true,
    () => false,
  );

describe("teleport-dialog-ui: the person moves a session to another host (#100)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    const t = TEXT[lang];

    test(`${lang}: the summary shows counts, a yes moves it with progress, and the session opens there`, async () => {
      const { calls, control } = open(lang);
      await start(lang);
      const summary = await shows(t.secrets);
      const branch = document.querySelector("bdi")?.textContent ?? null;
      await click(t.move);
      const answer = await control.answer;
      await act(async () => {
        control.progress?.(1024, 2048);
      });
      const moving = await shows(t.moving);
      await act(async () => {
        control.finish?.({ kind: "moved", sessionId: "t1", worktree: "/w", branch: "fd/x" });
      });
      const done = await shows(t.done);
      await click(t.open);
      expect([calls.args, summary, branch, answer, moving, done, calls.opened]).toEqual([
        [{ target: "h2", repo: "/work/app" }],
        true,
        "feature/login",
        true,
        true,
        true,
        [["h2", "t1"]],
      ]);
    });

    test(`${lang}: going back says no to the move, and the dialog closes`, async () => {
      const { calls, control } = open(lang);
      await start(lang);
      await shows(t.secrets);
      await click(t.back);
      const answer = await control.answer;
      await act(async () => {
        control.finish?.({ kind: "declined" });
      });
      expect([
        answer,
        await settle(() => calls.closed === 1).then(
          () => true,
          () => false,
        ),
      ]).toEqual([false, true]);
    });

    test(`${lang}: a refusal reads as the app's text, never the host's message`, async () => {
      const { control } = open(lang);
      await start(lang);
      await shows(t.secrets);
      await click(t.move);
      await act(async () => {
        control.fail?.(
          new RequestError("invalid_state", "host says ghp_secret", "teleport_no_project"),
        );
      });
      expect([
        await shows(t.refused),
        (document.body.textContent ?? "").includes("ghp_secret"),
      ]).toEqual([true, false]);
    });
  }

  test("Cancel during the move stops it, Escape on the summary says no, and Escape before it closes", async () => {
    const pressEscape = async () => {
      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      });
    };
    const first = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      first.control.progress?.(10, 100);
    });
    await shows("Moving… 10%");
    await click("Cancel");
    const stopped = first.control.signal?.aborted ?? false;
    cleanup();
    const moving = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      moving.control.progress?.(10, 100);
    });
    await shows("Moving… 10%");
    await pressEscape();
    const stoppedByEscape = moving.control.signal?.aborted ?? false;
    cleanup();
    const second = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    let answered: boolean | null = null;
    void second.control.answer?.then((yes) => {
      answered = yes;
    });
    await pressEscape();
    // The answer the run got, if any: a dialog that just closed never answers.
    const declined = await settle(() => answered !== null).then(
      () => answered,
      () => "no answer",
    );
    cleanup();
    const third = open("en");
    await pressEscape();
    expect([stopped, stoppedByEscape, declined, third.calls.closed]).toEqual([
      true,
      true,
      false,
      1,
    ]);
  });

  test("a session on no branch says so instead of a branch name", async () => {
    open("en", { ...SUMMARY, branch: null });
    await start("en");
    expect([await shows("none (a detached HEAD)"), document.querySelector("bdi") === null]).toEqual(
      [true, true],
    );
  });

  test("an error that is not a host's refusal, or a move that names no session, shows the app's alert instead of hanging", async () => {
    const first = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      first.control.fail?.(new TypeError("not a refusal"));
    });
    const failed = await settle(() => screen.queryByRole("alert") !== null).then(
      () => true,
      () => false,
    );
    cleanup();
    const second = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      second.control.finish?.({ kind: "moved", sessionId: "", worktree: "/w", branch: "fd/x" });
    });
    const nameless = await settle(() => screen.queryByRole("alert") !== null).then(
      () => true,
      () => false,
    );
    expect([failed, (document.body.textContent ?? "").includes("not a refusal"), nameless]).toEqual(
      [true, false, true],
    );
  });

  test("progress past the total or with nothing to send stays between 0% and 100%", async () => {
    const { control } = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      control.progress?.(5000, 2048);
    });
    const over = await shows("Moving… 100%");
    await act(async () => {
      control.progress?.(0, 0);
    });
    expect([over, await shows("Moving… 0%")]).toEqual([true, true]);
  });

  test("a second Continue while the host prepares starts no second move, and Cancel then frees the package and closes once", async () => {
    const { calls, control } = open("en", SUMMARY, true);
    await start("en");
    const preparing = await shows("Getting the session ready…");
    // A double-click or a second Enter: the form on screen is sent again.
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });
    const runs = calls.args.length;
    await click("Cancel");
    let answered: boolean | null = null;
    await act(async () => {
      control.ready?.();
    });
    void control.answer?.then((yes) => {
      answered = yes;
    });
    await settleMaybe(() => answered !== null, 2000);
    // The run ends as declined after the dialog already closed: it does not close it again.
    await act(async () => {
      control.finish?.({ kind: "declined" });
    });
    expect([preparing, runs, answered, calls.closed]).toEqual([true, 1, false, 1]);
  });

  test("Enter or a second click on Move never cancels the move it just started", async () => {
    const { control } = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      control.progress?.(10, 100);
    });
    await shows("Moving… 10%");
    const form = screen.queryByRole("status")?.closest("form") ?? null;
    expect(form).not.toBeNull();
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });
    const move = screen.queryByRole("button", { name: TEXT.en.move });
    expect(move).not.toBeNull();
    await act(async () => {
      fireEvent.click(move as HTMLElement);
    });
    expect([
      control.signal?.aborted ?? null,
      screen.queryByRole("button", { name: "Cancel" }) !== null,
    ]).toEqual([false, true]);
  });

  for (const [lang, finishingText, closeLabel] of [
    ["en", "Finishing on pi…", "Close"],
    ["pt-BR", "Finalizando em pi…", "Fechar"],
  ] as const) {
    test(`${lang}: once every byte is sent the move cannot be cancelled, but the dialog can close while the host finishes`, async () => {
      const { calls, control } = open(lang);
      await start(lang);
      await shows(TEXT[lang].secrets);
      await click(TEXT[lang].move);
      await act(async () => {
        control.progress?.(2048, 2048);
      });
      const finishing = await shows(finishingText);
      const cancel =
        screen.queryByRole("button", { name: lang === "en" ? "Cancel" : "Cancelar" }) !== null;
      // A host that never answers the import: the person is never stuck in the dialog.
      const close = screen.queryByRole("button", { name: closeLabel });
      expect(close).not.toBeNull();
      await act(async () => {
        fireEvent.click(close as HTMLElement);
      });
      expect([finishing, cancel, calls.closed, control.signal?.aborted ?? null]).toEqual([
        true,
        false,
        1,
        false,
      ]);
    });
  }

  test("Escape while the host finishes closes the dialog, and the move goes on", async () => {
    const { calls, control } = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      control.progress?.(2048, 2048);
    });
    await shows("Finishing on pi…");
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    expect([calls.closed, control.signal?.aborted ?? null]).toEqual([1, false]);
  });

  test("pt-BR: the dialog says it is getting the session ready while the host prepares", async () => {
    open("pt-BR", SUMMARY, true);
    await start("pt-BR");
    expect(await shows("Preparando a sessão…")).toBe(true);
  });

  test("a repository of spaces does not continue, and the one typed goes without its spaces", async () => {
    const { calls } = open("en");
    const host = screen.queryByRole("combobox", { name: TEXT.en.host });
    await act(async () => {
      fireEvent.change(host as HTMLElement, { target: { value: "h2" } });
    });
    const repo = screen.queryByRole("textbox", { name: "repo-path" });
    await act(async () => {
      fireEvent.change(repo as HTMLElement, { target: { value: "   " } });
    });
    const blank =
      (screen.queryByRole("button", { name: TEXT.en.next }) as HTMLButtonElement | null)
        ?.disabled ?? null;
    await act(async () => {
      fireEvent.change(repo as HTMLElement, { target: { value: "  /work/app  " } });
    });
    await click(TEXT.en.next);
    expect([blank, calls.args]).toEqual([true, [{ target: "h2", repo: "/work/app" }]]);
  });

  test("a reason the dialog does not expect never shows the host's words, and a known one shows its values as short plain text", async () => {
    const alertText = async (error: unknown) => {
      const { control } = open("en");
      await start("en");
      await shows(TEXT.en.secrets);
      await click(TEXT.en.move);
      await act(async () => {
        control.fail?.(error);
      });
      await settleMaybe(() => screen.queryByRole("alert") !== null);
      const text = screen.queryByRole("alert")?.textContent ?? "";
      cleanup();
      return text;
    };
    const unlisted = await alertText(
      new RequestError("invalid_state", "host says ghp_secret", "teleport_unlisted", {
        token: "ghp_secret",
      }),
    );
    const known = await alertText(
      new RequestError("bad_request", "x", "teleport_too_large", {
        max: `\u202e${"9".repeat(500)}`,
      }),
    );
    expect([
      unlisted.length > 0,
      unlisted.includes("ghp_secret"),
      known.startsWith("The transcript is larger than"),
      known.includes("\u202e"),
      known.length < 200,
    ]).toEqual([true, false, true, false, true]);
  });
});
