import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "../dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { QuotaGuard } = await import("../../src/features/quota/quota-guard.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

const host = {
  id: "a",
  name: "a",
  status: "online",
  hostInfo: { features: ["quota", "quotaPause"] },
};

// #4305: the guard shows the chosen value while the host answers, and says when the host refuses.
describe.each(["en", "pt-BR"] as const)("the guard while the host answers (%s)", (lang: Lang) => {
  const t = translator(lang);
  const guard = (
    setPause: (id: string, pauseAt: number | null) => Promise<boolean>,
    pauseAt: number,
  ) => (
    <TContext.Provider value={t}>
      <QuotaGuard store={{ quota: { setPause } } as never} host={host as never} pauseAt={pauseAt} />
    </TContext.Provider>
  );
  const select = () => screen.getByRole("combobox") as HTMLSelectElement;
  const choose = async (value: string) => {
    await act(async () => {
      fireEvent.change(select(), { target: { value } });
    });
  };
  const failed = () => screen.queryByText(t("quota.guard.failed"));

  /** A `setPause` whose answer the test gives when it likes. */
  function held() {
    const calls: Array<number | null> = [];
    let answer: (took: boolean) => void = () => undefined;
    const setPause = (_id: string, pauseAt: number | null) => {
      calls.push(pauseAt);
      return new Promise<boolean>((resolve) => {
        answer = resolve;
      });
    };
    return { calls, setPause, answer: (took: boolean) => act(async () => answer(took)) };
  }

  test("a pending change shows the chosen value, is busy, and a second change sends nothing", async () => {
    const ask = held();
    render(guard(ask.setPause, 0.8));
    await choose("0.9");
    expect(select().value).toBe("0.9");
    expect(select().disabled).toBe(true);
    expect(select().getAttribute("aria-busy")).toBe("true");
    await choose("0.6");
    expect(ask.calls).toEqual([0.9]);
  });

  test("when the host answers, the select shows its value and can be used again", async () => {
    const ask = held();
    const view = render(guard(ask.setPause, 0.8));
    await choose("0.9");
    await ask.answer(true);
    view.rerender(guard(ask.setPause, 0.9));
    expect(select().value).toBe("0.9");
    expect(select().disabled).toBe(false);
    expect(failed()).toBeNull();
  });

  test("a refusal puts the old value back and says the change did not take, until the next try", async () => {
    const ask = held();
    render(guard(ask.setPause, 0.8));
    await choose("0.9");
    await ask.answer(false);
    expect(select().value).toBe("0.8");
    expect(select().disabled).toBe(false);
    expect(failed()).not.toBeNull();
    await choose("0.7");
    expect(failed()).toBeNull();
  });
});
