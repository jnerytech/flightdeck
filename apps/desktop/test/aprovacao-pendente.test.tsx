import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ApprovalCard } = await import("../src/components/approval/approval-card.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const pt = translator("pt-BR");
const AT = "2026-10-29T12:00:00.000Z";
const NOW = Date.parse(AT) + 60_000;

/** An answer that stays pending until `settle()`, as a slow host does. */
function slowAnswer() {
  const calls: unknown[][] = [];
  let release: () => void = () => {};
  const onRespond = (...args: unknown[]) => {
    calls.push(args);
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  return { calls, onRespond, settle: () => act(async () => release()) };
}

function card(over: Record<string, unknown> = {}, risk?: "high") {
  const answer = slowAnswer();
  render(
    <ApprovalCard
      request={{
        requestId: "r1",
        toolName: "Bash",
        input: { command: "npm test" },
        cwd: "/repo",
        createdAt: AT,
        ...(risk ? { risk, riskReason: "motivo" } : {}),
      }}
      t={pt}
      nowMs={NOW}
      onRespond={answer.onRespond as never}
      holdMs={40}
      {...over}
    />,
  );
  const group = screen.getByRole("group", { name: "Pedido de Bash" });
  const button = (name: string) =>
    within(group).queryByRole("button", { name }) as HTMLButtonElement | null;
  return { ...answer, group, button };
}

const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};

describe("aprovacao-pendente: the card answers a click before the host does", () => {
  test("Aprovar goes busy at once, Negar is off, a second click or key sends nothing, and it comes back when the answer arrives", async () => {
    const { calls, button, group, settle } = card();
    await click(button("Aprovar"));
    expect(calls).toEqual([["allow"]]);
    expect(button("Aprovar")?.getAttribute("aria-busy")).toBe("true");
    expect(button("Aprovar")?.disabled).toBe(true);
    expect(button("Negar")?.disabled).toBe(true);
    await click(button("Aprovar"));
    await act(async () => {
      fireEvent.keyDown(group, { key: "a" });
      fireEvent.keyDown(group, { key: "n" });
    });
    expect(calls).toHaveLength(1);
    expect(button("Cancelar")).toBeNull();
    await settle();
    expect(button("Aprovar")?.disabled).toBe(false);
    expect(button("Aprovar")?.getAttribute("aria-busy")).toBeNull();
    expect(button("Negar")?.disabled).toBe(false);
  });

  test("Negar with a reason goes busy and sends the denial once", async () => {
    const { calls, button, group, settle } = card();
    await click(button("Negar"));
    await act(async () => {
      fireEvent.change(within(group).getByLabelText("Motivo (opcional)"), {
        target: { value: "não agora" },
      });
    });
    const deny = group.querySelectorAll("button");
    const confirm = [...deny].find((b) => b.textContent === "Negar") as HTMLButtonElement;
    await click(confirm);
    await click(confirm);
    expect(calls).toEqual([["deny", "não agora"]]);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(button("Cancelar")?.disabled).toBe(true);
    await settle();
    expect(confirm.getAttribute("aria-busy")).toBeNull();
  });

  test("the permission buttons are off while an answer is on its way", async () => {
    const { calls, button, settle } = card({ alwaysAllow: true });
    expect(button("Sempre neste projeto")).not.toBeNull();
    await click(button("Aprovar"));
    expect(button("Sempre neste projeto")?.disabled).toBe(true);
    await settle();
    expect(calls).toHaveLength(1);
    expect(button("Sempre neste projeto")?.disabled).toBe(false);
  });

  test("a high-risk approval cannot be held again while the first is on its way", async () => {
    const { calls, button, settle } = card({}, "high");
    const hold = button("Segurar para aprovar");
    expect(hold).not.toBeNull();
    await act(async () => {
      fireEvent.pointerDown(hold as HTMLElement);
      await Bun.sleep(80);
    });
    expect(calls).toEqual([["allow"]]);
    expect((hold as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.pointerDown(hold as HTMLElement);
      await Bun.sleep(80);
    });
    expect(calls).toHaveLength(1);
    await settle();
    expect((hold as HTMLButtonElement).disabled).toBe(false);
  });

  test("an answer that is not a promise leaves the card as it was", async () => {
    const calls: unknown[][] = [];
    render(
      <ApprovalCard
        request={{
          requestId: "r2",
          toolName: "Bash",
          input: { command: "ls" },
          cwd: "/repo",
          createdAt: AT,
        }}
        t={pt}
        nowMs={NOW}
        onRespond={(...args) => void calls.push(args)}
      />,
    );
    const approve = screen.getByRole("button", { name: "Aprovar" }) as HTMLButtonElement;
    await click(approve);
    await click(approve);
    expect(calls).toHaveLength(2);
    expect(approve.disabled).toBe(false);
  });

  test("an answer that fails (the connection dropped) leaves the card as it was, its buttons working again", async () => {
    const calls: unknown[][] = [];
    let fail: (error: Error) => void = () => {};
    render(
      <ApprovalCard
        request={{
          requestId: "r3",
          toolName: "Bash",
          input: { command: "ls" },
          cwd: "/repos",
          createdAt: AT,
        }}
        t={pt}
        nowMs={NOW}
        onRespond={(...args) => {
          calls.push(args);
          return new Promise<void>((_, reject) => {
            fail = reject;
          });
        }}
      />,
    );
    const approve = screen.getByRole("button", { name: "Aprovar" }) as HTMLButtonElement;
    await click(approve);
    expect(approve.disabled).toBe(true);
    await act(async () => fail(new Error("connection lost")));
    expect(approve.disabled).toBe(false);
    expect(approve.getAttribute("aria-busy")).toBeNull();
    await click(approve);
    expect(calls).toHaveLength(2);
  });
});
