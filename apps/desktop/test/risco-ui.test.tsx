import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { trayMenu } from "../src/lib/tray.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ApprovalCard, HIGH_RISK_HOLD_MS } = await import(
  "../src/components/approval/approval-card.tsx"
);

setDefaultTimeout(30_000);
afterEach(cleanup);

const pt = translator("pt-BR");
const en = translator("en");
const AT = "2026-10-29T12:00:00.000Z";
const NOW = Date.parse(AT) + 60_000;

const base = {
  requestId: "r1",
  toolName: "Bash",
  input: { command: "rm -rf build" },
  cwd: "/repo",
  createdAt: AT,
};
type Risk = "low" | "medium" | "high";

function card(risk: Risk | undefined, over: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const request = {
    ...base,
    ...(risk ? { risk, riskReason: `motivo ${risk}` } : {}),
  };
  render(
    <ApprovalCard
      request={request}
      t={pt}
      nowMs={NOW}
      onRespond={(...args) => calls.push(args)}
      holdMs={80}
      {...over}
    />,
  );
  return { calls, group: screen.getByRole("group", { name: "Pedido de Bash" }) };
}

const button = (g: HTMLElement, name: string) => within(g).queryByRole("button", { name });
const press = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.pointerDown(el);
  });
};
const release = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.pointerUp(el);
  });
};
const wait = (ms: number) => act(() => Bun.sleep(ms));

describe("risco-ui: o selo", () => {
  test("o risco aparece em palavras, baixo, médio e alto, e o motivo só no alto", () => {
    for (const [risk, label] of [
      ["low", "Risco baixo"],
      ["medium", "Risco médio"],
      ["high", "Risco alto"],
    ] as const) {
      const { group } = card(risk);
      const seal = within(group).getByText(label);
      expect(seal.closest("[data-risk]")?.getAttribute("data-risk")).toBe(risk);
      expect(!!within(group).queryByText("motivo high")).toBe(risk === "high");
      cleanup();
    }
  });

  test("em inglês o selo também fala a língua do usuário", () => {
    render(
      <ApprovalCard
        request={{ ...base, risk: "high", riskReason: "recursive delete" }}
        t={en}
        nowMs={NOW}
        onRespond={() => {}}
      />,
    );
    expect(screen.getByText("High risk")).toBeTruthy();
    expect(screen.getByText("recursive delete")).toBeTruthy();
  });

  test("um daemon antigo, que não manda o risco, não ganha selo e aprova como sempre", async () => {
    const { calls, group } = card(undefined);
    expect(group.querySelector("[data-risk]")).toBeNull();
    await act(async () => {
      fireEvent.click(button(group, "Aprovar") as HTMLElement);
    });
    expect(calls).toEqual([["allow"]]);
  });
});

describe("risco-ui: baixo e médio aprovam num toque", () => {
  test("o clique em Aprovar e a tecla A aprovam, e o médio ainda oferece Sempre permitir", async () => {
    for (const risk of ["low", "medium"] as const) {
      const { calls, group } = card(risk, { alwaysAllow: true });
      await act(async () => {
        fireEvent.click(button(group, "Aprovar") as HTMLElement);
        fireEvent.keyDown(group, { key: "a" });
      });
      expect(calls).toEqual([["allow"], ["allow"]]);
      expect(button(group, "Segurar para aprovar")).toBeNull();
      expect(button(group, "Sempre neste projeto")).toBeTruthy();
      cleanup();
    }
  });
});

describe("risco-ui: o alto pede para segurar", () => {
  test("em vez de Aprovar há Segurar para aprovar: um clique não aprova, a tecla A também não", async () => {
    const { calls, group } = card("high");
    expect(button(group, "Aprovar")).toBeNull();
    const hold = button(group, "Segurar para aprovar") as HTMLElement;
    await act(async () => {
      fireEvent.click(hold);
      fireEvent.keyDown(group, { key: "a" });
    });
    await wait(150);
    expect(calls).toEqual([]);
  });

  test("segurar o tempo todo aprova uma vez só, e a barra mostra o andamento", async () => {
    const { calls, group } = card("high");
    const hold = button(group, "Segurar para aprovar") as HTMLElement;
    await press(hold);
    expect(hold.getAttribute("data-holding")).toBe("true");
    await wait(160);
    expect(calls).toEqual([["allow"]]);
    await release(hold);
    await wait(120);
    expect(calls).toEqual([["allow"]]);
  });

  test("soltar antes do tempo, ou sair do botão com o ponteiro, cancela", async () => {
    const { calls, group } = card("high");
    const hold = button(group, "Segurar para aprovar") as HTMLElement;
    await press(hold);
    await wait(30);
    await release(hold);
    expect(hold.getAttribute("data-holding")).toBe("false");
    await press(hold);
    await wait(30);
    await act(async () => {
      fireEvent.pointerLeave(hold);
    });
    await wait(150);
    expect(calls).toEqual([]);
  });

  test("pelo teclado, segurar Espaço ou Enter vale o mesmo, e soltar cancela", async () => {
    const { calls, group } = card("high");
    const hold = button(group, "Segurar para aprovar") as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(hold, { key: " " });
    });
    await wait(30);
    await act(async () => {
      fireEvent.keyUp(hold, { key: " " });
    });
    await wait(120);
    expect(calls).toEqual([]);
    await act(async () => {
      fireEvent.keyDown(hold, { key: "Enter" });
      // The auto-repeat of a held key does not restart the count.
      fireEvent.keyDown(hold, { key: "Enter", repeat: true });
    });
    await wait(160);
    expect(calls).toEqual([["allow"]]);
  });

  test("o alto não oferece Sempre permitir, e Negar segue num toque", async () => {
    const { calls, group } = card("high", { alwaysAllow: true });
    expect(button(group, "Sempre neste projeto")).toBeNull();
    // The first touch opens the reason, the second denies.
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        fireEvent.click(button(group, "Negar") as HTMLElement);
      });
    }
    expect(calls).toEqual([["deny"]]);
  });

  test("o tempo de segurar é de 2 segundos", async () => {
    expect(HIGH_RISK_HOLD_MS).toBe(2000);
    const calls: unknown[][] = [];
    render(
      <ApprovalCard
        request={{ ...base, risk: "high" }}
        t={pt}
        nowMs={NOW}
        onRespond={(...args) => calls.push(args)}
      />,
    );
    const hold = screen.getByRole("button", { name: "Segurar para aprovar" });
    await press(hold);
    await wait(1700);
    expect(calls).toEqual([]);
    await wait(500);
    expect(calls).toEqual([["allow"]]);
  });
});

describe("risco-ui: a bandeja", () => {
  const item = (n: number, risk?: Risk) => ({
    hostId: "h",
    hostName: "alfa",
    sessionId: `s${n}`,
    sessionName: `sessão ${n}`,
    requestId: `r${n}`,
    toolName: "Bash",
    createdAt: AT,
    ...(risk ? { risk } : {}),
  });

  test("o pedido de risco alto só tem Abrir; os outros seguem com Aprovar, Negar e Abrir", () => {
    const menu = trayMenu([item(1, "high"), item(2, "medium"), item(3, "low"), item(4)]);
    expect(menu.items.map((i) => i.actions)).toEqual([
      ["open"],
      ["approve", "deny", "open"],
      ["approve", "deny", "open"],
      ["approve", "deny", "open"],
    ]);
  });
});

describe("risco-ui: aprovado automaticamente", () => {
  test("a linha do tempo diz que foi automático, por regra ou pela IA, e o motivo", () => {
    const resolution = {
      decision: "allow" as const,
      auto: { by: "rule" as const, reason: "leitura dentro da pasta do projeto", model: null },
    };
    render(
      <ApprovalCard
        request={{ ...base, risk: "low" }}
        t={pt}
        nowMs={NOW}
        resolution={resolution}
        onRespond={() => {}}
      />,
    );
    expect(
      screen.getByText("Aprovado automaticamente (regra): leitura dentro da pasta do projeto"),
    ).toBeTruthy();
    cleanup();
    render(
      <ApprovalCard
        request={{ ...base, risk: "medium" }}
        t={pt}
        nowMs={NOW}
        resolution={{
          decision: "allow",
          auto: { by: "ai", reason: "só lê a pasta", model: "claude-haiku-5-5" },
        }}
        onRespond={() => {}}
      />,
    );
    expect(
      screen.getByText("Aprovado automaticamente (IA, claude-haiku-5-5): só lê a pasta"),
    ).toBeTruthy();
  });

  test("uma resposta manual segue dizendo só aprovado ou negado", () => {
    render(
      <ApprovalCard
        request={{ ...base, risk: "low" }}
        t={pt}
        nowMs={NOW}
        resolution={{ decision: "allow" }}
        onRespond={() => {}}
      />,
    );
    expect(screen.queryByText(/automaticamente/)).toBeNull();
  });
});

describe("risco-ui: an automatic approval without a model", () => {
  test("an AI decision that names no model reads just AI", () => {
    render(
      <ApprovalCard
        request={{ ...base, risk: "medium" }}
        t={pt}
        nowMs={NOW}
        resolution={{
          decision: "allow",
          auto: { by: "ai", reason: "reads the folder", model: null },
        }}
        onRespond={() => {}}
      />,
    );
    expect(screen.getByText("Aprovado automaticamente (IA): reads the folder")).toBeTruthy();
  });
});
