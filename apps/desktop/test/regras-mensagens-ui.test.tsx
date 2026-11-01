import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { DEFAULT_POLICY, validatePolicy } from "../../daemon/src/messaging/policy.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}
const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const change = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | HTMLSelectElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

const POLICY = {
  ...DEFAULT_POLICY,
  perPairPerHour: 5,
  exceptions: [{ id: "e1", from: { host: "pc" }, to: { project: "app" } }],
};

async function open() {
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push("messaging");
  daemon.messaging.policy = structuredClone(POLICY);
  daemon.messaging.paused = ["h/s1|h/s2"];
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => {
    store.router.push({ name: "settings" });
  });
  await settle(() => screen.queryByText("de host pc para projeto app") !== null);
  /** What the last messaging.rules.set sent. */
  const lastSet = () =>
    daemon.commands.filter((c) => c.type === "messaging.rules.set").at(-1)?.payload as
      | { policy: Record<string, unknown>; unpause?: string[] }
      | undefined;
  return { store, daemon, lastSet };
}

describe("regras-mensagens-ui: who may message whom, retention and paused pairs in Configurações", () => {
  test("the section shows the exceptions, the retention and the paused pairs the host keeps", async () => {
    await open();
    expect(
      screen.queryByRole("region", { name: "Mensagens entre sessões em alfa" }),
    ).not.toBeNull();
    expect(screen.queryByText("de host pc para projeto app")).not.toBeNull();
    expect((screen.queryByLabelText("Retenção (dias)") as HTMLInputElement | null)?.value).toBe(
      "30",
    );
    expect(screen.queryByText("h/s1 e h/s2")).not.toBeNull();
  });

  test("an exception both ways joins the list, keeping the rest of the policy, and the host accepts it", async () => {
    const { lastSet } = await open();
    await change("De", "project");
    await change("Origem", "p1");
    await change("Para", "team");
    await change("Destino", "t1");
    const both = screen.queryByLabelText("Nos dois sentidos") as HTMLInputElement | null;
    expect(both).not.toBeNull();
    await act(async () => {
      fireEvent.click(both as HTMLElement);
    });
    await click("Adicionar exceção");
    await settle(() => lastSet() !== undefined);
    const policy = lastSet()?.policy as typeof POLICY;
    expect(policy).toEqual({
      ...POLICY,
      exceptions: [
        POLICY.exceptions[0],
        { id: expect.any(String), from: { project: "p1" }, to: { team: "t1" }, bothWays: true },
      ],
    } as never);
    expect(validatePolicy(policy).errors).toEqual([]);
    await settle(() => screen.queryByText("entre projeto p1 e time t1") !== null);
    expect(screen.queryByText("entre projeto p1 e time t1")).not.toBeNull();
  });

  test("Adicionar exceção is disabled until both sides are filled, and says why", async () => {
    await open();
    const button = screen.queryByRole("button", {
      name: "Adicionar exceção",
    }) as HTMLButtonElement | null;
    expect(button?.disabled).toBe(true);
    const reason = screen.queryByText("Preencha a origem e o destino da exceção.");
    expect(reason).not.toBeNull();
    expect(button?.getAttribute("aria-describedby")).toBe(reason?.id ?? "?");
  });

  test("removing an exception and saving the retention keep every other field", async () => {
    const { lastSet } = await open();
    await click("Remover a exceção de host pc para projeto app");
    await settle(() => lastSet() !== undefined);
    expect(lastSet()).toEqual({ policy: { ...POLICY, exceptions: [] } });
    await settle(() => screen.queryByText("de host pc para projeto app") === null);
    await change("Retenção (dias)", "7");
    await click("Salvar retenção");
    await settle(() => (lastSet()?.policy as typeof POLICY | undefined)?.retentionDays === 7);
    expect(lastSet()).toEqual({ policy: { ...POLICY, exceptions: [], retentionDays: 7 } });
  });

  test("Soltar frees a paused pair here and clears its entry in Precisa de você", async () => {
    const { store, daemon, lastSet } = await open();
    await act(async () => {
      daemon.push({
        type: "messaging.alert",
        kind: "loop",
        from: "h/s2",
        to: "h/s1",
        message: "laço",
        at: "2026-10-30T12:00:00.000Z",
      });
    });
    await settle(() => store.getState().loopAlerts.length === 1);
    await click("Soltar o par h/s1 e h/s2");
    await settle(() => lastSet() !== undefined);
    expect(lastSet()).toEqual({ policy: POLICY, unpause: ["h/s1|h/s2"] });
    await settle(() => screen.queryByText("h/s1 e h/s2") === null);
    expect(screen.queryByText("h/s1 e h/s2")).toBeNull();
    expect(store.getState().loopAlerts).toEqual([]);
  });

  test("a policy the host refuses says why, and the list stays as the host keeps it", async () => {
    const { daemon } = await open();
    daemon.refuse.set("messaging.rules.set", "exceção #2: from.host é um texto");
    await change("Origem", "x");
    await change("Destino", "y");
    await click("Adicionar exceção");
    await settle(() => screen.queryByText("exceção #2: from.host é um texto") !== null);
    expect(screen.queryByText("exceção #2: from.host é um texto")).not.toBeNull();
    expect(screen.queryByText("de host x para host y")).toBeNull();
  });

  test("the exception controls are one form: Enter adds it, Adicionar exceção is its submit and Nos dois sentidos sits in it", async () => {
    const { lastSet } = await open();
    const source = screen.queryByLabelText("Origem") as HTMLElement | null;
    const form = source?.closest("form") ?? null;
    expect(form).not.toBeNull();
    expect(form?.contains(screen.queryByLabelText("Nos dois sentidos"))).toBe(true);
    const add = screen.queryByRole("button", { name: "Adicionar exceção" }) as HTMLButtonElement;
    expect(add.type).toBe("submit");
    expect(form?.contains(add)).toBe(true);
    await change("Origem", "p1");
    await change("Destino", "t1");
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });
    await settle(() => lastSet() !== undefined);
    expect((lastSet()?.policy as typeof POLICY | undefined)?.exceptions).toHaveLength(2);
  });

  test("De, Para and Retenção (dias) each sit above their control, alone in their field", async () => {
    await open();
    for (const name of ["De", "Para", "Retenção (dias)"]) {
      const control = screen.queryByLabelText(name) as HTMLElement | null;
      expect(control).not.toBeNull();
      const label = document.querySelector(`label[for="${control?.id}"]`);
      const field = label?.parentElement;
      expect(field?.className ?? "").toContain("flex-col");
      expect(field?.querySelectorAll("label")).toHaveLength(1);
      expect(
        label?.nextElementSibling?.contains(control) || label?.nextElementSibling === control,
      ).toBe(true);
    }
  });

  test("the retention is its own form: Enter saves it, apart from the exception form", async () => {
    const { lastSet } = await open();
    const retention = screen.queryByLabelText("Retenção (dias)") as HTMLElement | null;
    const form = retention?.closest("form") ?? null;
    expect(form).not.toBeNull();
    expect(form).not.toBe(screen.queryByLabelText("Origem")?.closest("form"));
    expect(
      (screen.queryByRole("button", { name: "Salvar retenção" }) as HTMLButtonElement).type,
    ).toBe("submit");
    await change("Retenção (dias)", "9");
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });
    await settle(() => (lastSet()?.policy as typeof POLICY | undefined)?.retentionDays === 9);
    expect((lastSet()?.policy as typeof POLICY | undefined)?.retentionDays).toBe(9);
  });
});
