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

type Answer = () => Promise<unknown>;

/** A promise the test settles by hand: a call the host has not answered yet. */
function pending() {
  let settle: (value: unknown) => void = () => {};
  const promise = new Promise<unknown>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/**
 * The timeline's button on a store whose host answers each command as the test says: a result, or
 * `null` for a refusal. Every command sent is recorded, in order.
 */
async function timeline(language: "en" | "pt-BR", answers: Record<string, Answer>) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  cleanups.push(() => store.dispose());
  store.i18n.start();
  const sent: string[] = [];
  const answer = (type: string) => {
    sent.push(type);
    return (answers[type] ?? (async () => null))();
  };
  store.hostCommand = ((_host: string, type: string) => answer(type)) as never;
  store.hostRequest = (async (_host: string, type: string) => {
    const data = await answer(type);
    return data === null
      ? { ok: false, code: "refused", message: "the host said no" }
      : { ok: true, data };
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <CheckpointsButton store={store} hostId="h1" claudeSessionId="c1" cwd="/repo" busy={false} />
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
  return { sent, names };
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

  test("Undo rewind is busy until the host answers, so a second click sends nothing", async () => {
    const undone = pending();
    const { sent, names } = await timeline("en", {
      "snapshots.list": async () => SNAPSHOTS,
      "rewind.preview": async () => PREVIEW,
      "rewind.apply": async () => PREVIEW,
      "rewind.undo": () => undone.promise,
    });
    await click(names.rewind);
    await click("Rewind files");
    expect(screen.queryByText("Files rewound to turn 1.")).not.toBeNull();
    await click("Undo rewind");
    expect(isBusy("Undo rewind")).toBe(true);
    await click("Undo rewind");
    expect(sent.filter((type) => type === "rewind.undo")).toHaveLength(1);
    await act(async () => undone.settle(PREVIEW));
    expect(screen.queryByText("Rewind undone.")).not.toBeNull();
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
    expect(alerts()).toContain("Could not rewind the files: the host said no");
    expect(isBusy("Rewind files")).toBe(false);
    expect(isDisabled("Rewind files")).toBe(false);
    await click("Rewind files");
    expect(screen.queryByRole("dialog", { name: "Rewind files to turn 1" })).toBeNull();
    expect(screen.queryByText("Files rewound to turn 1.")).not.toBeNull();
  });
});
