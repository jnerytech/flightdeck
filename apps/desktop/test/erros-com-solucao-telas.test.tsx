import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { RulesEditor } = await import("../src/components/vault/rules-editor.tsx");
const { MessagingRulesSection } = await import("../src/ui/MessagingRulesSection.tsx");
const { ActionForm } = await import("../src/ui/ActionForm.tsx");
const { ChangesPanel } = await import("../src/ui/ChangesPanel.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

import type { AppStore } from "../src/lib/app-store.ts";

afterEach(cleanup);

const REFUSED = { ok: false, code: "invalid_state", message: "sessão em uso" };
const TEXT = "Não dá para fazer isso agora.";

const press = async (view: ReturnType<typeof render>, name: string) => {
  const button = [...view.container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  );
  expect(button).not.toBeUndefined();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(10));
};

describe("erros-com-solucao: refusals shown by forms", () => {
  test("the vault rules editor says what the code means, then the daemon's message", async () => {
    const store = {
      vaultRules: () => [],
      getState: () => ({ clientList: [] }),
      setVaultRules: async () => REFUSED,
    } as unknown as AppStore;
    const secret = { id: "s1", name: "token", rules: [] } as never;
    const view = render(<RulesEditor store={store} secret={secret} onClose={() => {}} />);
    await press(view, "Salvar regras");
    expect(view.container.textContent).toContain(`${TEXT} sessão em uso`);
  });

  test("the messaging rules section says what the code means, then the daemon's message", async () => {
    const store = {
      hostCommand: async () => ({ policy: { exceptions: [], retentionDays: 30 }, paused: [] }),
      hostRequest: async () => REFUSED,
      i18n: { t: (key: string) => key },
    } as unknown as AppStore;
    const view = render(<MessagingRulesSection store={store} hostId="h" hostName="alfa" />);
    await act(() => Bun.sleep(10));
    await press(view, "Salvar retenção");
    expect(view.container.textContent).toContain(`${TEXT} sessão em uso`);
  });

  const GENERIC =
    "O host informou um erro que o app não conhece. Tente de novo; se repetir, confira o log do daemon.";
  for (const [code, shown] of [
    ["invalid_state", TEXT],
    ["quota_exceeded", GENERIC],
  ] as const) {
    test(`the action form shows ${code} as the dictionary text, then the daemon's message`, async () => {
      const store = {
        hostRequest: async () => ({ ok: false, code, message: "ação em uso" }),
        getState: () => ({ secrets: [] }),
        i18n: { t: translator("pt-BR") },
      } as unknown as AppStore;
      const view = render(
        <ActionForm
          store={store}
          hostId="h"
          projectId="p"
          initial={null}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      );
      const submit = document.body.querySelector("button[type=submit]");
      expect(submit).not.toBeNull();
      await act(async () => {
        fireEvent.click(submit as HTMLElement);
      });
      await act(() => Bun.sleep(10));
      const alert = document.body.querySelector("[role=alert]")?.textContent ?? "";
      expect(alert).toBe(`${shown} ação em uso`);
      view.unmount();
    });

    test(`the changes panel shows ${code} as the dictionary text, then the daemon's message`, async () => {
      const store = {
        hostRequest: async () => ({ ok: false, code, message: "sem mudanças" }),
        hostCommand: async () => null,
        watchChanges: () => () => {},
        i18n: { t: translator("pt-BR") },
      } as unknown as AppStore;
      const view = render(
        <TContext.Provider value={translator("pt-BR")}>
          <ChangesPanel store={store} hostId="h" target="session:abc" />
        </TContext.Provider>,
      );
      await act(() => Bun.sleep(20));
      expect(view.container.textContent).toContain(`${shown} sem mudanças`);
    });
  }
});
