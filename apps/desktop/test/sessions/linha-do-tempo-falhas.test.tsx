import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { CheckpointsButton } = await import("../../src/features/checkpoints/ui.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { formatDateTime } = await import("../../src/i18n/format.ts");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** One turn that changed a file: a `before` and an `after` snapshot with different trees. */
const SNAPSHOTS = {
  snapshots: [
    { kind: "before", n: 1, tree: "a", prompt: "fix the README", turnUuid: "u1" },
    { kind: "after", n: 2, tree: "b", prompt: null, turnUuid: null },
  ].map((row) => ({
    ...row,
    claudeSessionId: "c1",
    ref: `refs/${row.n}`,
    createdAt: "2026-11-21T10:00:00.000Z",
    repo: "/repo",
  })),
};
const PREVIEW = {
  via: "snapshot",
  files: [{ path: "README.md", change: "modified" }],
  insertions: 1,
  deletions: 1,
};

/** The turns above plus the safety snapshot a rewind leaves: the host has a rewind to undo. */
const SAFETY = {
  snapshots: [
    ...SNAPSHOTS.snapshots,
    {
      kind: "safety",
      n: 3,
      tree: "c",
      prompt: null,
      turnUuid: null,
      claudeSessionId: "c1",
      ref: "refs/3",
      createdAt: "2026-11-21T11:00:00.000Z",
      repo: "/repo",
    },
  ],
};
const EMPTY = { via: "snapshot", files: [], insertions: 0, deletions: 0 };

type Answer = () => Promise<unknown>;

/** A promise the test settles by hand: a call the host has not answered yet. */
function pending() {
  let settle: (value: unknown) => void = () => {};
  const promise = new Promise<unknown>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** A refusal that carries the host's reason, which the app writes in its own language. */
const refused = (why: { reason: string; params?: Record<string, string | number> }) => ({
  refusal: { code: "refused", message: "the host said no", ...why },
});
const refusalOf = (data: unknown) =>
  typeof data === "object" && data !== null && "refusal" in data
    ? (data as ReturnType<typeof refused>).refusal
    : null;

/**
 * The timeline's button on a store whose host answers each command as the test says: a result, a
 * `refused(...)` or `null` for a plain refusal. Every command sent is recorded, in order, and so is
 * each one that went through `hostCommand`, which puts a refusal in the app banner.
 */
async function timeline(language: "en" | "pt-BR", answers: Record<string, Answer>, busy = false) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  cleanups.push(() => store.dispose());
  store.i18n.start();
  const sent: string[] = [];
  const banner: string[] = [];
  const answer = (type: string) => {
    sent.push(type);
    return (answers[type] ?? (async () => null))();
  };
  store.hostCommand = (async (_host: string, type: string) => {
    banner.push(type);
    const data = await answer(type);
    return refusalOf(data) ? null : data;
  }) as never;
  store.hostRequest = (async (_host: string, type: string) => {
    const data = await answer(type);
    const refusal = refusalOf(data);
    if (refusal) return { ok: false, ...refusal };
    return data === null
      ? { ok: false, code: "refused", message: "the host said no" }
      : { ok: true, data };
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <CheckpointsButton store={store} hostId="h1" claudeSessionId="c1" cwd="/repo" busy={busy} />
    </TContext.Provider>,
  );
  const names = {
    en: {
      open: "Timeline",
      fork: "Fork from here (turn 1)",
      rewind: "Rewind files to here (turn 1)",
    },
    "pt-BR": {
      open: "Linha do tempo",
      fork: "Bifurcar daqui (turno 1)",
      rewind: "Voltar arquivos até aqui (turno 1)",
    },
  }[language];
  const open = screen.queryByRole("button", { name: names.open });
  expect(open).not.toBeNull();
  await act(async () => {
    fireEvent.click(open as HTMLElement);
  });
  return { sent, banner, names, store };
}

const click = async (name: string | RegExp) => {
  const element = screen.queryByRole("button", { name });
  expect(element).not.toBeNull();
  await act(async () => {
    fireEvent.click(element as HTMLElement);
  });
};

const tick = async (name: string) => {
  const box = screen.queryByRole("checkbox", { name });
  expect(box).not.toBeNull();
  await act(async () => {
    fireEvent.click(box as HTMLElement);
  });
};

/** What the person reads in alerts. */
const alerts = () => screen.queryAllByRole("alert").map((el) => el.textContent ?? "");
const isDisabled = (name: string) =>
  screen.queryByRole("button", { name })?.hasAttribute("disabled") === true;
const isBusy = (name: string) =>
  screen.queryByRole("button", { name })?.getAttribute("aria-busy") === "true";

describe("linha-do-tempo-falhas", () => {
  test("a refused load of the turns says so and offers Try again, then shows the turns", async () => {
    let tries = 0;
    await timeline("en", {
      "snapshots.list": async () => (++tries === 1 ? null : SNAPSHOTS),
    });
    expect(alerts().some((text) => text.includes("Could not load the turns"))).toBe(true);
    expect(screen.queryByText("Loading the turns…")).toBeNull();
    await click("Try again");
    expect(screen.queryByText("fix the README")).not.toBeNull();
    expect(alerts()).toEqual([]);
  });

  test("a refused load of the turns reads the same in Portuguese", async () => {
    await timeline("pt-BR", { "snapshots.list": async () => null });
    expect(alerts().some((text) => text.includes("Não deu para carregar os turnos"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeNull();
    expect(screen.queryByText("Carregando os turnos…")).toBeNull();
  });

  test("Show files is busy until the host answers, so a second click sends nothing", async () => {
    const files = pending();
    const { sent } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "snapshots.files": () => files.promise,
    });
    await click("Show files of turn 1");
    expect(isBusy("Show files of turn 1")).toBe(true);
    await click("Show files of turn 1");
    expect(sent.filter((type) => type === "snapshots.files")).toHaveLength(1);
    await act(async () => files.settle(PREVIEW));
    expect(screen.queryByText("README.md")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Hide files of turn 1" })).not.toBeNull();
  });

  test("a refused read of a turn's files says so in its row, and Try again reads them again", async () => {
    let tries = 0;
    const { sent } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "snapshots.files": async () => (++tries === 1 ? null : PREVIEW),
    });
    await click("Show files of turn 1");
    expect(alerts().some((text) => text.includes("Could not read the files of turn 1"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Hide files of turn 1" })).toBeNull();
    await click("Try again");
    expect(sent.filter((type) => type === "snapshots.files")).toHaveLength(2);
    expect(screen.queryByText("README.md")).not.toBeNull();
    expect(alerts()).toEqual([]);
  });

  test("Try again stays in sight and busy while the new read goes on", async () => {
    const again = pending();
    let tries = 0;
    await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "snapshots.files": () => (++tries === 1 ? Promise.resolve(null) : again.promise),
    });
    await click("Show files of turn 1");
    await click("Try again");
    expect(isBusy("Try again")).toBe(true);
    await act(async () => again.settle(PREVIEW));
    expect(screen.queryByText("README.md")).not.toBeNull();
    expect(alerts()).toEqual([]);
  });

  test("a refused read of a turn's files reads the same in Portuguese", async () => {
    await timeline("pt-BR", {
      "snapshots.list": async () => SNAPSHOTS,
      "snapshots.files": async () => null,
    });
    await click("Ver arquivos do turno 1");
    expect(alerts().some((text) => text.includes("Não deu para ler os arquivos do turno 1"))).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeNull();
  });

  test("the sheet's Close sits in the title row, above the description, and the title is heading-sized", async () => {
    await timeline("en", { "snapshots.list": async () => SNAPSHOTS });
    const title = screen.queryByText("Timeline", { selector: "[data-slot='sheet-title']" });
    const close = screen.queryByRole("button", { name: "Close" });
    expect(title).not.toBeNull();
    expect(close).not.toBeNull();
    const row = (title as HTMLElement).parentElement as HTMLElement;
    expect(row.contains(close)).toBe(true);
    const description = row.parentElement?.querySelector("[data-slot='sheet-description']");
    expect(description?.parentElement === row.parentElement && !row.contains(description)).toBe(
      true,
    );
    expect((title as HTMLElement).classList.contains("text-lg")).toBe(true);
  });

  test("the sheet's Close is in the title row in Portuguese too, and it still closes the sheet", async () => {
    await timeline("pt-BR", { "snapshots.list": async () => SNAPSHOTS });
    const title = screen.queryByText("Linha do tempo", { selector: "[data-slot='sheet-title']" });
    const close = screen.queryByRole("button", { name: "Fechar" });
    expect(title).not.toBeNull();
    expect(close).not.toBeNull();
    const row = (title as HTMLElement).parentElement as HTMLElement;
    expect(row.contains(close)).toBe(true);
    expect(row.querySelector("[data-slot='sheet-description']")).toBeNull();
    await click("Fechar");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the Fork dialog says when the file preview failed and Try again runs it again", async () => {
    let tries = 0;
    const { sent, names } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "rewind.preview": async () => (++tries === 1 ? null : PREVIEW),
    });
    await click(names.fork);
    await tick("Also rewind the files");
    expect(alerts().some((text) => text.includes("Could not work out"))).toBe(true);
    expect(screen.queryByText("Working out what changes…")).toBeNull();
    expect(isDisabled("Fork")).toBe(true);
    await click("Try again");
    expect(sent.filter((type) => type === "rewind.preview")).toHaveLength(2);
    expect(screen.queryByText("README.md")).not.toBeNull();
    expect(isDisabled("Fork")).toBe(false);
  });

  test("Fork waits for the file preview and says why", async () => {
    const preview = pending();
    const { names } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "rewind.preview": () => preview.promise,
    });
    await click(names.fork);
    expect(isDisabled("Fork")).toBe(false);
    await tick("Also rewind the files");
    expect(isDisabled("Fork")).toBe(true);
    expect(screen.queryByText(/Fork needs the list of files above first/)).not.toBeNull();
    await act(async () => preview.settle(PREVIEW));
    expect(isDisabled("Fork")).toBe(false);
    expect(screen.queryByText(/Fork needs the list of files above first/)).toBeNull();
  });

  test("Fork is busy until the host answers, so a second click sends nothing", async () => {
    const forked = pending();
    const { sent, names } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "session.fork": () => forked.promise,
    });
    await click(names.fork);
    await click("Fork");
    expect(isBusy("Fork")).toBe(true);
    await click("Fork");
    expect(sent.filter((type) => type === "session.fork")).toHaveLength(1);
    await act(async () => forked.settle(null));
    expect(isBusy("Fork")).toBe(false);
  });

  test("Restore files in the undo dialog is busy until the host answers, so a second click sends nothing", async () => {
    const undone = pending();
    const { sent, names } = await timeline("en", {
      "snapshots.list": async () => SAFETY,
      "rewind.preview": async () => PREVIEW,
      "rewind.apply": async () => PREVIEW,
      "rewind.undoPreview": async () => PREVIEW,
      "rewind.undo": () => undone.promise,
    });
    await click(names.rewind);
    await click("Rewind files");
    expect(screen.queryByText("Files rewound to turn 1.")).not.toBeNull();
    await click("Undo rewind");
    await click("Restore files");
    expect(isBusy("Restore files")).toBe(true);
    await click("Restore files");
    expect(sent.filter((type) => type === "rewind.undo")).toHaveLength(1);
    await act(async () => undone.settle(PREVIEW));
    expect(screen.queryByText("Rewind undone.")).not.toBeNull();
  });

  // #4036: the Undo comes from what the host says, so it survives the sheet closing.
  test("a rewind the host can undo is offered on a fresh sheet, with no rewind in this one, and nothing is undone by looking", async () => {
    const { sent } = await timeline("en", {
      "snapshots.list": async () => SAFETY,
      "rewind.undoPreview": async () => PREVIEW,
    });
    expect(sent).toContain("rewind.undoPreview");
    expect(screen.queryByText(/The files of this session were rewound/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Undo rewind" })).not.toBeNull();
    expect(sent).not.toContain("rewind.undo");
  });

  test("an empty undo preview offers no Undo", async () => {
    const { sent } = await timeline("en", {
      "snapshots.list": async () => SAFETY,
      "rewind.undoPreview": async () => EMPTY,
    });
    expect(sent).toContain("rewind.undoPreview");
    expect(screen.queryByRole("button", { name: "Undo rewind" })).toBeNull();
    expect(screen.queryByText(/The files of this session were rewound/)).toBeNull();
  });

  test("a host that refuses the undo preview offers no Undo and shows no alert", async () => {
    const { sent } = await timeline("en", { "snapshots.list": async () => SAFETY });
    expect(sent).toContain("rewind.undoPreview");
    expect(screen.queryByRole("button", { name: "Undo rewind" })).toBeNull();
    expect(alerts()).toEqual([]);
  });

  test("a session with no rewind is asked once, the host refuses, and there is no Undo", async () => {
    const { sent } = await timeline("en", { "snapshots.list": async () => SNAPSHOTS });
    expect(screen.queryByText("fix the README")).not.toBeNull();
    expect(sent.filter((type) => type === "rewind.undoPreview")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Undo rewind" })).toBeNull();
  });

  test("with the session in a turn the Undo is off and says why, and the dialog is not opened", async () => {
    const { sent } = await timeline(
      "en",
      {
        "snapshots.list": async () => SAFETY,
        "rewind.undoPreview": async () => PREVIEW,
      },
      true,
    );
    expect(isDisabled("Undo rewind")).toBe(true);
    const reason = screen
      .queryByRole("button", { name: "Undo rewind" })
      ?.getAttribute("aria-describedby");
    expect(reason).toBeTruthy();
    expect(document.getElementById(reason as string)?.textContent).toContain("in a turn");
    await click("Undo rewind");
    expect(screen.queryByRole("dialog", { name: "Undo the rewind" })).toBeNull();
    expect(sent).not.toContain("rewind.undo");
  });

  test("an answer to an older undo preview does not bring the Undo back after a newer one said there is none", async () => {
    const first = pending();
    let asked = 0;
    await timeline("en", {
      "snapshots.list": async () => SAFETY,
      "rewind.preview": async () => PREVIEW,
      "rewind.apply": async () => PREVIEW,
      "rewind.undoPreview": () => (++asked === 1 ? first.promise : Promise.resolve(EMPTY)),
    });
    await click("Rewind files to here (turn 1)");
    await click("Rewind files");
    expect(screen.queryByText("Files rewound to turn 1.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Undo rewind" })).toBeNull();
    await act(async () => first.settle(PREVIEW));
    expect(screen.queryByRole("button", { name: "Undo rewind" })).toBeNull();
  });

  test("an undo dialog whose preview is refused says so in its own words and keeps Restore off", async () => {
    let tries = 0;
    await timeline("en", {
      "snapshots.list": async () => SAFETY,
      "rewind.undoPreview": async () => (++tries === 1 ? PREVIEW : null),
    });
    await click("Undo rewind");
    expect(alerts()).toContain(
      "Could not work out what the undo changes: The host reported an error the app does not know. Try again; if it repeats, check the daemon's log. the host said noTry again",
    );
    expect(screen.queryByText("Working out what changes…")).toBeNull();
    expect(isDisabled("Restore files")).toBe(true);
  });

  test("Undo opens a dialog that lists the files and warns that later changes are overwritten; Cancel sends nothing, Restore sends the undo and the Undo goes away", async () => {
    let undone = false;
    const { sent } = await timeline("en", {
      "snapshots.list": async () => SAFETY,
      "rewind.undoPreview": async () => (undone ? EMPTY : PREVIEW),
      "rewind.undo": async () => {
        undone = true;
        return PREVIEW;
      },
    });
    await click("Undo rewind");
    const dialog = screen.queryByRole("dialog", { name: "Undo the rewind" });
    expect(dialog).not.toBeNull();
    const inside = within(dialog as HTMLElement);
    expect(inside.queryByText("README.md")).not.toBeNull();
    expect(inside.queryByText(/Changes made since the rewind are overwritten/)).not.toBeNull();
    await click("Cancel");
    expect(screen.queryByRole("dialog", { name: "Undo the rewind" })).toBeNull();
    expect(sent).not.toContain("rewind.undo");
    await click("Undo rewind");
    await click("Restore files");
    expect(sent.filter((type) => type === "rewind.undo")).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "Undo the rewind" })).toBeNull();
    expect(screen.queryByText("Rewind undone.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Undo rewind" })).toBeNull();
  });

  test("an undo dialog that finds nothing to restore says so and keeps Restore off", async () => {
    let tries = 0;
    await timeline("en", {
      "snapshots.list": async () => SAFETY,
      "rewind.undoPreview": async () => (++tries === 1 ? PREVIEW : EMPTY),
    });
    await click("Undo rewind");
    expect(screen.queryByText(/Nothing to undo/)).not.toBeNull();
    expect(isDisabled("Restore files")).toBe(true);
  });

  test("a refused undo keeps its dialog open with the reason", async () => {
    await timeline("en", {
      "snapshots.list": async () => SAFETY,
      "rewind.undoPreview": async () => PREVIEW,
      "rewind.undo": async () => null,
    });
    await click("Undo rewind");
    await click("Restore files");
    expect(screen.queryByRole("dialog", { name: "Undo the rewind" })).not.toBeNull();
    expect(alerts()).toContain(
      "Could not undo the rewind: The host reported an error the app does not know. Try again; if it repeats, check the daemon's log. the host said no",
    );
  });

  test("the undo dialog reads the same in Portuguese", async () => {
    await timeline("pt-BR", {
      "snapshots.list": async () => SAFETY,
      "rewind.undoPreview": async () => PREVIEW,
    });
    expect(screen.queryByText(/Os arquivos desta sessão voltaram/)).not.toBeNull();
    await click("Desfazer volta");
    expect(screen.queryByRole("dialog", { name: "Desfazer a volta" })).not.toBeNull();
    expect(screen.queryByText(/mudanças feitas depois da volta são sobrescritas/i)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Restaurar arquivos" })).not.toBeNull();
  });

  test("a refused rewind keeps its dialog open with the reason, and a retry that works closes it", async () => {
    let tries = 0;
    const { names } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "rewind.preview": async () => PREVIEW,
      "rewind.apply": async () => (++tries === 1 ? null : PREVIEW),
    });
    await click(names.rewind);
    await click("Rewind files");
    expect(screen.queryByRole("dialog", { name: "Rewind files to turn 1" })).not.toBeNull();
    expect(alerts()).toContain(
      "Could not rewind the files: The host reported an error the app does not know. Try again; if it repeats, check the daemon's log. the host said no",
    );
    expect(isBusy("Rewind files")).toBe(false);
    expect(isDisabled("Rewind files")).toBe(false);
    await click("Rewind files");
    expect(screen.queryByRole("dialog", { name: "Rewind files to turn 1" })).toBeNull();
    expect(screen.queryByText("Files rewound to turn 1.")).not.toBeNull();
  });

  // #4112: a refusal is told once, where it happened, with the host's reason.
  const TURN_RUNNING = refused({ reason: "rewind_turn_running" });
  const TURN_RUNNING_TEXT = "The session is in a turn: stop it before rewinding.";

  test("a refused load of the turns is told once, with the host's reason, and not in the banner", async () => {
    const { banner } = await timeline("en", { "snapshots.list": async () => TURN_RUNNING });
    expect(alerts()).toEqual([
      `Could not load the turns of this session: ${TURN_RUNNING_TEXT}Try again`,
    ]);
    expect(banner).not.toContain("snapshots.list");
  });

  test("a refused load of the turns gives its reason in Portuguese", async () => {
    await timeline("pt-BR", { "snapshots.list": async () => TURN_RUNNING });
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain("Não deu para carregar os turnos desta sessão: ");
    expect(alerts()[0]).toContain("A sessão está num turno: pare-a antes de voltar.");
  });

  test("a refused rewind preview keeps its dialog open with the reason once, Rewind stays off and the banner is not used", async () => {
    const { names, banner } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "rewind.preview": async () => TURN_RUNNING,
    });
    await click(names.rewind);
    expect(screen.queryByRole("dialog", { name: "Rewind files to turn 1" })).not.toBeNull();
    expect(alerts()).toEqual([
      `Could not work out what the rewind changes: ${TURN_RUNNING_TEXT}Try again`,
    ]);
    expect(screen.queryByText("Working out what changes…")).toBeNull();
    expect(isDisabled("Rewind files")).toBe(true);
    expect(banner).not.toContain("rewind.preview");
  });

  // #4249: Rewind and Undo tell a refusal as Fork does, by its code in the app's language, and a refused preview can be asked again.
  test("a refused Rewind preview can be asked again, and then lists the files", async () => {
    let tries = 0;
    const { names } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "rewind.preview": async () => (++tries === 1 ? TURN_RUNNING : PREVIEW),
    });
    await click(names.rewind);
    await click("Try again");
    expect(alerts()).toEqual([]);
    expect(screen.queryByText("README.md")).not.toBeNull();
    expect(isDisabled("Rewind files")).toBe(false);
  });

  test("a refused Rewind gives the reason in the app's language", async () => {
    const { names } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "rewind.preview": async () => PREVIEW,
      "rewind.apply": async () => TURN_RUNNING,
    });
    await click(names.rewind);
    await click("Rewind files");
    expect(alerts()).toEqual([`Could not rewind the files: ${TURN_RUNNING_TEXT}`]);
  });

  test("a refused Rewind gives the reason in Portuguese", async () => {
    const { names } = await timeline("pt-BR", {
      "snapshots.list": async () => SNAPSHOTS,
      "rewind.preview": async () => PREVIEW,
      "rewind.apply": async () => TURN_RUNNING,
    });
    await click(names.rewind);
    await click("Voltar arquivos");
    expect(alerts()).toEqual([
      "Não deu para voltar os arquivos: A sessão está num turno: pare-a antes de voltar.",
    ]);
  });

  test("a refused Undo gives the reason in the app's language", async () => {
    await timeline("en", {
      "snapshots.list": async () => SAFETY,
      "rewind.undoPreview": async () => PREVIEW,
      "rewind.undo": async () => TURN_RUNNING,
    });
    await click("Undo rewind");
    await click("Restore files");
    expect(alerts()).toEqual([`Could not undo the rewind: ${TURN_RUNNING_TEXT}`]);
  });

  test("a refused Undo preview gives its reason, and Try again lists the files", async () => {
    let tries = 0;
    await timeline("en", {
      "snapshots.list": async () => SAFETY,
      "rewind.undoPreview": async () =>
        ++tries === 1 ? PREVIEW : tries === 2 ? TURN_RUNNING : PREVIEW,
    });
    await click("Undo rewind");
    expect(alerts()).toEqual([
      `Could not work out what the undo changes: ${TURN_RUNNING_TEXT}Try again`,
    ]);
    await click("Try again");
    expect(alerts()).toEqual([]);
    expect(screen.queryByText("README.md")).not.toBeNull();
    expect(isDisabled("Restore files")).toBe(false);
  });

  test("a refused Undo preview gives its reason in Portuguese", async () => {
    let tries = 0;
    await timeline("pt-BR", {
      "snapshots.list": async () => SAFETY,
      "rewind.undoPreview": async () => (++tries === 1 ? PREVIEW : TURN_RUNNING),
    });
    await click("Desfazer volta");
    expect(alerts()).toEqual([
      "Não deu para saber o que o desfazer muda: A sessão está num turno: pare-a antes de voltar.Tentar de novo",
    ]);
  });

  test("a refused Fork file preview gives its reason once and does not use the banner", async () => {
    const { names, banner } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "rewind.preview": async () => TURN_RUNNING,
    });
    await click(names.fork);
    await tick("Also rewind the files");
    expect(alerts()).toEqual([
      `Could not work out what the rewind changes: ${TURN_RUNNING_TEXT}Try again`,
    ]);
    expect(banner).not.toContain("rewind.preview");
  });

  test("a refused Fork keeps its dialog open with an alert that holds the reason, and Fork can be pressed again", async () => {
    let tries = 0;
    const { names, banner } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "session.fork": async () => (++tries === 1 ? TURN_RUNNING : { claudeSessionId: "c2" }),
    });
    await click(names.fork);
    await click("Fork");
    expect(screen.queryByRole("dialog", { name: "Fork from turn 1" })).not.toBeNull();
    expect(alerts()).toEqual([`Could not fork the conversation: ${TURN_RUNNING_TEXT}`]);
    expect(banner).not.toContain("session.fork");
    expect(isBusy("Fork")).toBe(false);
    await click("Fork");
    expect(alerts()).toEqual([]);
    expect(screen.queryByText(/Conversation forked/)).not.toBeNull();
  });

  test("a Fork refused for its folder offers to allow the folder, and allowing it sends the Fork again", async () => {
    let tries = 0;
    const { names, sent, store } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "session.fork": async () =>
        ++tries === 1 ? refused({ reason: "cwd_outside_roots", params: { cwd: "/repo" } }) : null,
    });
    const allowed: Array<[string, string]> = [];
    store.roster.allowRoot = (async (host: string, folder: string, retry?: () => void) => {
      allowed.push([host, folder]);
      retry?.();
      return true;
    }) as never;
    await click(names.fork);
    await click("Fork");
    expect(alerts()[0]).toContain("The folder /repo is outside the host's allowed folders");
    await click("Add to allowed folders");
    expect(allowed).toEqual([]);
    const confirm = screen.queryByRole("alertdialog");
    expect(confirm).not.toBeNull();
    await act(async () => {
      fireEvent.click(
        within(confirm as HTMLElement).getByRole("button", { name: "Add to allowed folders" }),
      );
    });
    expect(allowed).toEqual([["h1", "/repo"]]);
    expect(sent.filter((type) => type === "session.fork")).toHaveLength(2);
  });

  test("a Fork refused for another reason offers no way to allow a folder", async () => {
    const { names } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "session.fork": async () => TURN_RUNNING,
    });
    await click(names.fork);
    await click("Fork");
    expect(screen.queryByRole("button", { name: "Add to allowed folders" })).toBeNull();
  });

  test("a refused Fork reads the same in Portuguese", async () => {
    const { names } = await timeline("pt-BR", {
      "snapshots.list": async () => SNAPSHOTS,
      "session.fork": async () => TURN_RUNNING,
    });
    await click(names.fork);
    await click("Bifurcar");
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain("Não deu para bifurcar a conversa: ");
  });

  test("a reload refused after a rewind says so above the list, which stays, and Try again brings the new one", async () => {
    let loads = 0;
    const { names, banner } = await timeline("en", {
      "snapshots.list": async () => (++loads === 2 ? TURN_RUNNING : SNAPSHOTS),
      "rewind.preview": async () => PREVIEW,
      "rewind.apply": async () => PREVIEW,
    });
    await click(names.rewind);
    await click("Rewind files");
    expect(screen.queryByText("Files rewound to turn 1.")).not.toBeNull();
    expect(alerts()).toEqual([
      `Could not load the turns of this session: ${TURN_RUNNING_TEXT}Try again`,
    ]);
    expect(screen.queryByText("fix the README")).not.toBeNull();
    expect(banner).not.toContain("snapshots.list");
    await click("Try again");
    expect(alerts()).toEqual([]);
    expect(screen.queryByText("fix the README")).not.toBeNull();
  });

  // The button that had the focus is gone after Try again: the focus goes on, to the list or to the new Try again.
  const listHasFocus = () => {
    const list = screen.queryByRole("list", { name: "Turns" });
    expect(list).not.toBeNull();
    const focused = document.activeElement;
    return focused !== null && focused !== document.body && focused.contains(list);
  };

  test("after Try again brings the turns, the focus is on the list", async () => {
    let tries = 0;
    await timeline("en", { "snapshots.list": async () => (++tries === 1 ? null : SNAPSHOTS) });
    await click("Try again");
    expect(listHasFocus()).toBe(true);
  });

  test("after a Try again that is refused again, the focus is on Try again", async () => {
    await timeline("en", { "snapshots.list": async () => null });
    await click("Try again");
    expect(document.activeElement?.textContent).toBe("Try again");
  });

  test("a refusal that answers an older load does not replace the list a newer load brought", async () => {
    const older = pending();
    let loads = 0;
    const { names } = await timeline("en", {
      "snapshots.list": () => (++loads === 2 ? older.promise : Promise.resolve(SAFETY)),
      "rewind.undoPreview": async () => PREVIEW,
      "rewind.undo": async () => PREVIEW,
      "rewind.preview": async () => PREVIEW,
      "rewind.apply": async () => PREVIEW,
    });
    await click("Undo rewind");
    await click("Restore files");
    await click(names.rewind);
    await click("Rewind files");
    expect(loads).toBe(3);
    await act(async () => older.settle(TURN_RUNNING));
    expect(alerts()).toEqual([]);
    expect(screen.queryByText("fix the README")).not.toBeNull();
  });
  // #4250: a dialog says which turn it acts on, and the forked command can be copied.
  const LONG_PROMPT = `${"explain the whole design ".repeat(12)}and then fix the README`;
  const withPrompt = (prompt: string | null) => ({
    snapshots: SNAPSHOTS.snapshots.map((row) => (row.n === 1 ? { ...row, prompt } : row)),
  });
  const dialogOf = (name: string) => within(screen.queryByRole("dialog", { name }) as HTMLElement);

  test("the Rewind and Fork dialogs show the turn's time and prompt", async () => {
    const { names, store } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "rewind.preview": async () => PREVIEW,
    });
    await click(names.rewind);
    const rewind = dialogOf("Rewind files to turn 1");
    expect(rewind.queryByText("fix the README")).not.toBeNull();
    expect(
      rewind.queryByText(formatDateTime("2026-11-21T10:00:00.000Z", store.i18n.lang)),
    ).not.toBeNull();
    await click("Cancel");
    await click(names.fork);
    const fork = dialogOf("Fork from turn 1");
    expect(fork.queryByText("fix the README")).not.toBeNull();
    expect(
      fork.queryByText(formatDateTime("2026-11-21T10:00:00.000Z", store.i18n.lang)),
    ).not.toBeNull();
  });

  test("a long prompt is clamped in the dialog, with Show more", async () => {
    const { names } = await timeline("en", {
      "snapshots.list": async () => withPrompt(LONG_PROMPT),
      "rewind.preview": async () => PREVIEW,
    });
    await click(names.fork);
    const fork = dialogOf("Fork from turn 1");
    const more = fork.queryByRole("button", { name: "Show more" });
    expect(more?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.click(more as HTMLElement);
    });
    expect(fork.queryByRole("button", { name: "Show less" })?.getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  test("a turn with no prompt says so in the dialog", async () => {
    const { names } = await timeline("en", {
      "snapshots.list": async () => withPrompt(null),
      "rewind.preview": async () => PREVIEW,
    });
    await click(names.rewind);
    expect(dialogOf("Rewind files to turn 1").queryByText("(no prompt recorded)")).not.toBeNull();
  });

  test("the forked command can be copied", async () => {
    const { names, store } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "session.fork": async () => ({ claudeSessionId: "c2", command: "claude --resume c2" }),
    });
    const copied: string[] = [];
    store.system.copyText = (async (text: string) => {
      copied.push(text);
      return true;
    }) as never;
    await click(names.fork);
    await tick("Open in the terminal");
    await click("Fork");
    await click("Copy the command");
    expect(copied).toEqual(["claude --resume c2"]);
  });

  test("the dialog's time and the copy button read in Portuguese", async () => {
    const { names, store } = await timeline("pt-BR", {
      "snapshots.list": async () => SNAPSHOTS,
      "session.fork": async () => ({ claudeSessionId: "c2", command: "claude --resume c2" }),
    });
    await click(names.fork);
    expect(
      dialogOf("Bifurcar a partir do turno 1").queryByText(
        formatDateTime("2026-11-21T10:00:00.000Z", store.i18n.lang),
      ),
    ).not.toBeNull();
    await tick("Abrir no terminal");
    await click("Bifurcar");
    expect(screen.queryByRole("button", { name: "Copiar o comando" })).not.toBeNull();
  });
});
