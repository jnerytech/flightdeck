import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { StartFromGithub } = await import("../../src/features/projects/start-from-github.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");
const { settleMaybe } = await import("../wait.ts");

afterEach(cleanup);

/**
 * #4488: picking a repository showed the previous repository's issues under the new heading while
 * the new ones loaded, and a refused read said "No open issue.". Each state now says what it is,
 * and the answer of a pick the person left is dropped.
 */
const repo = (name: string) => ({
  name,
  description: "",
  private: false,
  url: "u",
  updatedAt: "2026-10-01T10:00:00Z",
});
type Refusal = { ok: false; code: string; message: string };
const REFUSED: Refusal = { ok: false, code: "busy", message: "gh is busy" };
const issuesOf = (...items: Array<[string, string]>) => ({
  ok: true as const,
  data: { issues: items.map(([id, title]) => ({ id, title })) },
});

/** A store whose `github.issues` reads wait for the test to answer them, in the order asked. */
function gated() {
  const waiting: Array<{ repo: string; answer: (result: unknown) => void }> = [];
  const store = {
    getState: () => ({ hosts: [{ id: "h", info: { allowedRoots: ["/a"] } }] }),
    router: { push: () => {} },
    hostRequest: (_host: string, type: string, payload: { repo?: string }) => {
      if (type === "github.repos") {
        return Promise.resolve({ ok: true, data: { repos: [repo("o/a"), repo("o/b")] } });
      }
      return new Promise((answer) => waiting.push({ repo: payload.repo ?? "", answer }));
    },
  };
  /** Answers the oldest read of `name`, once the dialog has asked for it. */
  const answer = async (name: string, result: unknown) => {
    expect(await settleMaybe(() => waiting.some((w) => w.repo === name), 3000)).toBe(true);
    const at = waiting.findIndex((w) => w.repo === name);
    const [read] = waiting.splice(at, 1);
    await act(async () => read?.answer(result));
  };
  return { store: store as never, answer, asks: () => waiting.length };
}

async function open(language: "en" | "pt-BR" = "en") {
  const page = gated();
  render(
    <TContext.Provider value={translator(language)}>
      <StartFromGithub store={page.store} hostId="h" onStarted={() => {}} />
    </TContext.Provider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /GitHub/ }));
  });
  expect(
    await settleMaybe(() => screen.queryByRole("radio", { name: /o\/b/ }) !== null, 3000),
  ).toBe(true);
  return page;
}
const pick = async (name: RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("radio", { name }));
  });
};
const issues = (name: string) =>
  within(screen.getByRole("region", { name: `Issues of ${name}` }) as HTMLElement);

describe("github-issues-states: the issues of the repository picked (#4488)", () => {
  test("picking another repository drops the old issues at once and says the new ones are loading", async () => {
    const page = await open();
    await pick(/o\/a/);
    await page.answer("o/a", issuesOf(["1", "Only in A"]));
    expect(await settleMaybe(() => screen.queryByText(/Only in A/) !== null, 3000)).toBe(true);
    await pick(/o\/b/);
    const section = issues("o/b");
    expect([
      screen.queryByText(/Only in A/) === null,
      section.queryByText("Loading issues…") !== null,
      section.queryByText("No open issue.") === null,
      section.queryByRole("radio", { name: "No issue: just the repository" }) !== null,
    ]).toEqual([true, true, true, true]);
  });

  test("a refused read says the issues could not be read, with Try again, not No open issue", async () => {
    const page = await open();
    await pick(/o\/b/);
    await page.answer("o/b", REFUSED);
    expect(
      await settleMaybe(() => screen.queryByRole("button", { name: "Try again" }) !== null, 3000),
    ).toBe(true);
    const section = issues("o/b");
    expect([
      section.queryByText("The issues could not be read.") !== null,
      section.queryByText("No open issue.") === null,
      section.queryByRole("radio", { name: "No issue: just the repository" }) !== null,
    ]).toEqual([true, true, true]);
  });

  test("Try again asks the host again and lists the issues it answers with", async () => {
    const page = await open();
    await pick(/o\/b/);
    await page.answer("o/b", REFUSED);
    expect(
      await settleMaybe(() => screen.queryByRole("button", { name: "Try again" }) !== null, 3000),
    ).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    await page.answer("o/b", issuesOf(["9", "Fix B"]));
    expect(await settleMaybe(() => screen.queryByText(/Fix B/) !== null, 3000)).toBe(true);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("Try again keeps the focus on its button while the host is asked again", async () => {
    const page = await open();
    await pick(/o\/b/);
    await page.answer("o/b", REFUSED);
    expect(
      await settleMaybe(() => screen.queryByRole("button", { name: "Try again" }) !== null, 3000),
    ).toBe(true);
    (screen.getByRole("button", { name: "Try again" }) as HTMLElement).focus();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await settleMaybe(() => page.asks() === 1, 3000)).toBe(true);
    expect(document.activeElement === screen.queryByRole("button", { name: "Try again" })).toBe(
      true,
    );
    await page.answer("o/b", REFUSED);
    expect(
      await settleMaybe(() => screen.queryByRole("button", { name: "Try again" }) !== null, 3000),
    ).toBe(true);
    expect(document.activeElement === screen.queryByRole("button", { name: "Try again" })).toBe(
      true,
    );
  });

  test("the answer of a pick the person left is dropped", async () => {
    const page = await open();
    await pick(/o\/a/);
    await pick(/o\/b/);
    await page.answer("o/b", issuesOf(["2", "Only in B"]));
    expect(await settleMaybe(() => screen.queryByText(/Only in B/) !== null, 3000)).toBe(true);
    await page.answer("o/a", issuesOf(["1", "Late from A"]));
    expect([
      screen.queryByText(/Late from A/) === null,
      screen.queryByText(/Only in B/) !== null,
    ]).toEqual([true, true]);
  });

  test("a host that answers with no issues still says No open issue", async () => {
    const page = await open();
    await pick(/o\/b/);
    await page.answer("o/b", issuesOf());
    expect(
      await settleMaybe(() => issues("o/b").queryByText("No open issue.") !== null, 3000),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("pt-BR: a refused read says so, with Tentar de novo", async () => {
    const page = await open("pt-BR");
    await pick(/o\/b/);
    await page.answer("o/b", REFUSED);
    expect(
      await settleMaybe(
        () => screen.queryByRole("button", { name: "Tentar de novo" }) !== null,
        3000,
      ),
    ).toBe(true);
    expect(screen.queryByText("Não foi possível ler as issues.") !== null).toBe(true);
  });
});

describe("github-issues-states: one notice, and no side effect of a left pick (#4488)", () => {
  test("a refused read is announced once", async () => {
    const page = await open();
    await pick(/o\/b/);
    await page.answer("o/b", REFUSED);
    expect(
      await settleMaybe(() => screen.queryByRole("button", { name: "Try again" }) !== null, 3000),
    ).toBe(true);
    expect(screen.getAllByRole("alert").length).toBe(1);
  });

  test("the refusal of a pick the person left raises no error over the one shown", async () => {
    const page = await open();
    await pick(/o\/a/);
    await pick(/o\/b/);
    await page.answer("o/b", issuesOf(["2", "Only in B"]));
    expect(await settleMaybe(() => screen.queryByText(/Only in B/) !== null, 3000)).toBe(true);
    await page.answer("o/a", REFUSED);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("while Try again asks again, the old alert is gone so a new failure announces again", async () => {
    const page = await open();
    await pick(/o\/b/);
    await page.answer("o/b", REFUSED);
    expect(
      await settleMaybe(() => screen.queryByRole("button", { name: "Try again" }) !== null, 3000),
    ).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await settleMaybe(() => page.asks() === 1, 3000)).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
